-- Pruebas de aislamiento (RLS), activación, contraseña temporal y funciones.
-- Se ejecutan con scripts/test-db.sh sobre una base temporal.
\set ON_ERROR_STOP 1

-- Usuarios de prueba ---------------------------------------------------------
-- A = 'aaaaaaaa-…' (aprovisionado), B = 'bbbbbbbb-…' (aprovisionado),
-- X = 'cccccccc-…' (registro público sin aprovisionar), ADMIN = 'dddddddd-…'
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ana@example.com', '{"provisioned":"true","role":"user"}', '{"full_name":"Ana"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'beto@example.com', '{"provisioned":"true","role":"user"}', '{}'),
  ('cccccccc-0000-0000-0000-000000000003', 'intruso@example.com', '{}', '{"full_name":"Intruso"}'),
  ('dddddddd-0000-0000-0000-000000000004', 'admin@example.com', '{"provisioned":"true","role":"admin"}', '{}');

do $$
begin
  assert (select is_active and must_change_password and role = 'user' and full_name = 'Ana'
          from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'El perfil aprovisionado debe nacer activo y con contraseña temporal';
  assert (select not is_active and role = 'user'
          from public.profiles where id = 'cccccccc-0000-0000-0000-000000000003'),
    'Un registro sin aprovisionar debe quedar inactivo';
  assert (select role = 'admin' from public.profiles where id = 'dddddddd-0000-0000-0000-000000000004'),
    'El rol admin se toma de app_metadata';
end $$;

-- Helper para actuar como un usuario (equivalente al JWT que inyecta PostgREST).
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
$$;

-- 1. Con contraseña temporal pendiente no hay acceso a datos ------------------
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
do $$
declare ok boolean := false;
begin
  begin
    insert into public.exercises (name, muscle_group_id) values ('Press de banca', 'pecho');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'Con contraseña temporal pendiente no se debe poder crear ejercicios';
  assert (select count(*) from public.profiles) = 1, 'Debe poder leer su propio perfil';
end $$;
reset role;

-- El servidor marca el cambio de contraseña como hecho.
update public.profiles set must_change_password = false
where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
             'dddddddd-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003');

-- 2. Ana registra Press de banca y una dominada (peso corporal) ---------------
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;

insert into public.exercises (id, name, muscle_group_id) values
  ('e0000000-0000-0000-0000-00000000000a', 'Press de banca', 'pecho'),
  ('e0000000-0000-0000-0000-00000000000b', 'Dominadas', 'espalda');

do $$
declare ok boolean := false;
begin
  begin
    insert into public.exercises (name, muscle_group_id) values ('  press de BANCA ', 'pecho');
  exception when unique_violation then ok := true;
  end;
  assert ok, 'No se permiten dos ejercicios activos con el mismo nombre';
end $$;

-- Jueves 19/11: 40×12, 45×10, 50×8 (+ dominadas sin peso)
select from public.save_workout_session('{
  "id": "50000000-0000-0000-0000-000000000001",
  "session_date": "2026-11-19",
  "exercises": [
    {"exercise_id": "e0000000-0000-0000-0000-00000000000a",
     "sets": [{"reps": 12, "weight_kg": 40}, {"reps": 10, "weight_kg": 45}, {"reps": 8, "weight_kg": 50}]},
    {"exercise_id": "e0000000-0000-0000-0000-00000000000b",
     "sets": [{"reps": 10, "weight_kg": null}, {"reps": 8, "weight_kg": null}]}
  ]}'::jsonb);

-- Doble clic / reintento: mismo id, ninguna duplicación.
select from public.save_workout_session('{
  "id": "50000000-0000-0000-0000-000000000001",
  "session_date": "2026-11-19",
  "exercises": [
    {"exercise_id": "e0000000-0000-0000-0000-00000000000a",
     "sets": [{"reps": 12, "weight_kg": 40}, {"reps": 10, "weight_kg": 45}, {"reps": 8, "weight_kg": 50}]},
    {"exercise_id": "e0000000-0000-0000-0000-00000000000b",
     "sets": [{"reps": 10, "weight_kg": null}, {"reps": 8, "weight_kg": null}]}
  ]}'::jsonb);

do $$
begin
  assert (select count(*) from public.workout_sessions) = 1, 'Reintentar no debe duplicar la sesión';
  assert (select count(*) from public.session_exercises) = 2, 'Reintentar no debe duplicar ejercicios';
  assert (select count(*) from public.exercise_sets) = 5, 'Reintentar no debe duplicar series';
end $$;

-- Jueves siguiente 26/11 con decimales.
select from public.save_workout_session('{
  "id": "50000000-0000-0000-0000-000000000002",
  "session_date": "2026-11-26",
  "exercises": [
    {"exercise_id": "e0000000-0000-0000-0000-00000000000a",
     "sets": [{"reps": 12, "weight_kg": 42.5}, {"reps": 10, "weight_kg": 47.25}, {"reps": 8, "weight_kg": 52.5}]}
  ]}'::jsonb);

do $$
declare
  r record;
begin
  -- Series anteriores a la fecha elegida (26/11) → las del 19/11.
  select * into r from public.get_previous_exercise_sets(
    array['e0000000-0000-0000-0000-00000000000a']::uuid[], '2026-11-26', '50000000-0000-0000-0000-000000000002');
  assert r.session_date = '2026-11-19', 'Debe mostrar la sesión anterior del 19/11';
  assert r.sets = '[{"reps": 12, "weight_kg": 40.00}, {"reps": 10, "weight_kg": 45.00}, {"reps": 8, "weight_kg": 50.00}]'::jsonb,
    format('Series anteriores incorrectas: %s', r.sets);

  -- Antes del 19/11 no hay historial.
  assert not exists (select 1 from public.get_previous_exercise_sets(
    array['e0000000-0000-0000-0000-00000000000a']::uuid[], '2026-11-19', null)),
    'No debe haber series anteriores al 19/11';

  -- Decimales exactos.
  assert (select array_agg(es.weight_kg order by es.position) from public.exercise_sets es
          join public.session_exercises se on se.id = es.session_exercise_id
          where se.session_id = '50000000-0000-0000-0000-000000000002')
         = array[42.50, 47.25, 52.50]::numeric[], 'Los decimales del peso deben conservarse';

  -- Progreso: dos sesiones, peso máximo por sesión.
  assert (select array_agg(max_weight_kg order by session_date)
          from public.get_exercise_progress('e0000000-0000-0000-0000-00000000000a', null, null))
         = array[50.00, 52.50]::numeric[], 'Progreso: peso máximo por sesión';
  assert (select count(*) from public.get_exercise_progress('e0000000-0000-0000-0000-00000000000a', '2026-11-20', null)) = 1,
    'Filtro por rango de fechas en progreso';

  -- Peso corporal: sin peso, con repeticiones.
  select * into r from public.get_exercise_progress('e0000000-0000-0000-0000-00000000000b', null, null);
  assert r.max_weight_kg is null and r.max_reps = 10 and r.total_reps = 18, 'Peso corporal: repeticiones';

  -- Historial con filtros.
  assert (select count(*) from public.list_workout_sessions(null, null, 100)) = 2, 'Historial completo';
  assert (select count(*) from public.list_workout_sessions('2026-11-01', '2026-11-20', 100)) = 1, 'Historial filtrado';
end $$;

-- Más de un decimal permitido = dos. Tres decimales se rechazan.
do $$
declare ok boolean := false;
begin
  begin
    perform public.save_workout_session('{
      "id": "50000000-0000-0000-0000-000000000003", "session_date": "2026-11-26",
      "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": [{"reps": 5, "weight_kg": 40.125}]}]}'::jsonb);
  exception when invalid_parameter_value then ok := true;
  end;
  assert ok, 'Tres decimales deben rechazarse';
  assert not exists (select 1 from public.workout_sessions where id = '50000000-0000-0000-0000-000000000003'),
    'Un guardado fallido no debe dejar la sesión a medias';
end $$;

-- Edición de una sesión anterior: quitar una serie y cambiar la fecha.
select from public.save_workout_session('{
  "id": "50000000-0000-0000-0000-000000000001",
  "session_date": "2026-11-18",
  "exercises": [
    {"exercise_id": "e0000000-0000-0000-0000-00000000000a",
     "sets": [{"reps": 12, "weight_kg": 40}, {"reps": 9, "weight_kg": 45.5}]},
    {"exercise_id": "e0000000-0000-0000-0000-00000000000b",
     "sets": [{"reps": 10, "weight_kg": null}, {"reps": 8, "weight_kg": null}]}
  ]}'::jsonb);
do $$
declare s jsonb := public.get_workout_session('50000000-0000-0000-0000-000000000001');
begin
  assert s ->> 'session_date' = '2026-11-18', 'La fecha editada debe guardarse';
  assert jsonb_array_length(s -> 'exercises' -> 0 -> 'sets') = 2, 'La serie quitada no debe quedar';
  assert (s -> 'exercises' -> 0 -> 'sets' -> 1 ->> 'weight_kg')::numeric = 45.5, 'La serie editada debe guardarse';
end $$;

-- Archivar conserva el historial.
update public.exercises set archived_at = now() where id = 'e0000000-0000-0000-0000-00000000000b';
do $$
begin
  assert (select count(*) from public.get_exercise_progress('e0000000-0000-0000-0000-00000000000b', null, null)) = 1,
    'Archivar no debe perder el historial';
  assert (public.get_workout_session('50000000-0000-0000-0000-000000000001') -> 'exercises' -> 1 ->> 'archived')::boolean,
    'La sesión muestra el ejercicio archivado';
end $$;

-- Resumen de progreso (lista de «Progreso») ------------------------------------
-- Remo: 40×10,10,8 (20/11) → 40×10,10,10 (22/11) → 42,5×6 (22/11, segunda del día)
-- → solo peso corporal (23/11, no comparable para un ejercicio con peso).
insert into public.exercises (id, name, muscle_group_id) values
  ('e0000000-0000-0000-0000-00000000000c', 'Remo con barra', 'espalda');
select from public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000010", "session_date": "2026-11-20",
  "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000c",
    "sets": [{"reps": 10, "weight_kg": 40}, {"reps": 10, "weight_kg": 40}, {"reps": 8, "weight_kg": 40}]}]}'::jsonb);
select from public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000011", "session_date": "2026-11-22",
  "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000c",
    "sets": [{"reps": 10, "weight_kg": 40}, {"reps": 10, "weight_kg": 40}, {"reps": 10, "weight_kg": 40}]}]}'::jsonb);
do $$
declare r record;
begin
  select * into r from public.get_progress_overview() where exercise_id = 'e0000000-0000-0000-0000-00000000000c';
  assert r.uses_weight and r.session_count = 2 and r.last_session_date = '2026-11-22', format('Resumen Remo: %s', r);
  assert r.recent -> 0 -> 'best_set' = '{"reps": 10, "weight_kg": 40.00}'::jsonb, format('Mejor serie: %s', r.recent);
  assert (r.recent -> 0 ->> 'total_reps')::int = 30 and (r.recent -> 1 ->> 'total_reps')::int = 28,
    'Reps totales 30 y 28';
  assert r.recent -> 1 -> 'best_set' = '{"reps": 10, "weight_kg": 40.00}'::jsonb,
    'Empate en peso: gana la serie con más reps (40×10, no 40×8)';
end $$;

select from public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000012", "session_date": "2026-11-22",
  "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000c", "sets": [{"reps": 6, "weight_kg": 42.5}]}]}'::jsonb);
select from public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000013", "session_date": "2026-11-23",
  "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000c", "sets": [{"reps": 12, "weight_kg": null}]}]}'::jsonb);
do $$
declare r record;
begin
  select * into r from public.get_progress_overview() where exercise_id = 'e0000000-0000-0000-0000-00000000000c';
  assert r.session_count = 4 and r.last_session_date = '2026-11-23'
         and r.last_session_id = '50000000-0000-0000-0000-000000000013', 'La última sesión incluye la que no tiene peso';
  assert jsonb_array_length(r.recent) = 2, 'Solo las dos últimas comparables';
  assert r.recent -> 0 ->> 'session_id' = '50000000-0000-0000-0000-000000000012',
    format('Dos sesiones el mismo día: la más reciente es la creada después (%s)', r.recent);
  assert r.recent -> 1 ->> 'session_id' = '50000000-0000-0000-0000-000000000011', 'La anterior es la primera del 22/11';

  -- Press de banca: 52,5×8 (26/11) frente a 45,5×9 (18/11).
  select * into r from public.get_progress_overview() where exercise_id = 'e0000000-0000-0000-0000-00000000000a';
  assert r.recent -> 0 -> 'best_set' = '{"reps": 8, "weight_kg": 52.50}'::jsonb
     and r.recent -> 1 -> 'best_set' = '{"reps": 9, "weight_kg": 45.50}'::jsonb, format('Press: %s', r.recent);

  -- Dominadas (peso corporal, archivado): una sola sesión, mejor serie = más reps.
  select * into r from public.get_progress_overview() where exercise_id = 'e0000000-0000-0000-0000-00000000000b';
  assert not r.uses_weight and jsonb_array_length(r.recent) = 1
     and r.recent -> 0 -> 'best_set' = '{"reps": 10, "weight_kg": null}'::jsonb, format('Dominadas: %s', r);
end $$;
reset role;

select from pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
do $$
begin
  assert not exists (select 1 from public.get_progress_overview()), 'El resumen de progreso es privado';
end $$;
reset role;

-- Limpieza del escenario de Remo (las pruebas siguientes cuentan las sesiones de Ana).
delete from public.workout_sessions where id::text like '50000000-0000-0000-0000-00000000001_';
delete from public.exercises where id = 'e0000000-0000-0000-0000-00000000000c';
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
reset role;

-- Estado de sesión e Inicio --------------------------------------------------------
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
do $$
declare r jsonb; v_first timestamptz; n int;
begin
  -- Las sesiones nuevas empiezan en curso.
  assert (select count(*) from public.workout_sessions where finished_at is null) = 2, 'Las sesiones nuevas están en curso';
  r := public.finish_workout_session('50000000-0000-0000-0000-000000000002');
  v_first := (r ->> 'finished_at')::timestamptz;
  assert v_first is not null, 'Finalizar marca la fecha de cierre';
  perform pg_sleep(0.01);
  -- Idempotente: finalizar otra vez conserva la primera fecha.
  assert (public.finish_workout_session('50000000-0000-0000-0000-000000000002') ->> 'finished_at')::timestamptz = v_first,
    'Finalizar dos veces no cambia la fecha';
  -- Guardar después de finalizar (corrección) conserva el estado.
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000002", "session_date": "2026-11-26",
    "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a",
      "sets": [{"reps": 12, "weight_kg": 42.5}, {"reps": 10, "weight_kg": 47.25}, {"reps": 8, "weight_kg": 52.5}]}]}'::jsonb);
  assert (select finished_at = v_first from public.workout_sessions where id = '50000000-0000-0000-0000-000000000002'),
    'Corregir una sesión finalizada no la reabre';
  assert (public.get_workout_session('50000000-0000-0000-0000-000000000002') ->> 'finished_at') is not null, 'El detalle incluye el estado';
  assert (select finished_at is not null from public.list_workout_sessions(null, null, 100) where id = '50000000-0000-0000-0000-000000000002'),
    'El historial incluye el estado';

  -- Inicio: ventana desde el 20/11 (solo la del 26/11) + las que siguen en curso (la del 18/11).
  select count(*) into n from public.get_home_sessions('2026-11-20', 3);
  assert n = 2, format('Inicio debe traer la de la semana y la en curso: %s', n);
  -- Ventana vacía: las 0 finalizadas recientes no agregan nada, la en curso sí.
  assert (select count(*) from public.get_home_sessions('2030-01-01', 0)) = 1, 'Solo la sesión en curso';
  assert (select muscle_groups from public.get_home_sessions('2026-11-20', 3) where id = '50000000-0000-0000-0000-000000000002')
         = '["Pecho"]'::jsonb, 'Grupos musculares de la sesión';
  assert (select exercise_count = 1 and set_count = 3 from public.get_home_sessions('2026-11-20', 3)
          where id = '50000000-0000-0000-0000-000000000002'), 'Conteos de ejercicios y series';
  -- Grupos en el orden de la sesión y sin repetir.
  assert (select muscle_groups from public.get_home_sessions('2026-11-01', 3) where id = '50000000-0000-0000-0000-000000000001')
         = '["Pecho", "Espalda"]'::jsonb, 'Grupos en orden de la sesión';
end $$;
reset role;

-- Historial: búsqueda por ejercicio, rango y páginas ---------------------------------
-- Ana: 001 (18/11: Press de banca, Dominadas [archivado]), 002 (26/11: Press de banca)
-- y una segunda sesión el 26/11 (003) para comprobar el mismo día y el cursor.
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select from public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000003", "session_date": "2026-11-26",
  "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": [{"reps": 5, "weight_kg": 60}]}]}'::jsonb);
do $$
declare ids uuid[]; r record;
begin
  -- Todo: más reciente primero; las dos del mismo día se conservan.
  select array_agg(s.id order by ord) into ids
  from (select h.id, row_number() over () as ord from public.search_workout_sessions() h) s;
  assert ids = array['50000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002',
                     '50000000-0000-0000-0000-000000000001']::uuid[], format('Orden del historial: %s', ids);
  assert (select total_count from public.search_workout_sessions() limit 1) = 3, 'Total de sesiones';

  -- Búsqueda sin mayúsculas ni tildes; varias coincidencias en una sesión → una sola fila.
  assert (select count(*) from public.search_workout_sessions(p_query => 'DOMÍN')) = 1, 'Busca sin tildes ni mayúsculas';
  assert (select count(*) from public.search_workout_sessions(p_query => 'a')) = 3, 'Cada sesión una sola vez';
  assert (select count(*) from public.search_workout_sessions(p_query => '%')) = 0, 'Los comodines se buscan literalmente';
  assert (select count(*) from public.search_workout_sessions(p_query => '   ')) = 3, 'Búsqueda vacía = sin filtro';

  -- Búsqueda combinada con rango, y límites sueltos.
  assert (select count(*) from public.search_workout_sessions('2026-11-20', null, 'press')) = 2, 'Búsqueda + desde';
  assert (select count(*) from public.search_workout_sessions(null, '2026-11-20', 'press')) = 1, 'Búsqueda + hasta';
  assert (select count(*) from public.search_workout_sessions('2026-11-20', '2026-11-25')) = 0, 'Rango sin resultados';

  -- Resumen de la tarjeta: grupos, conteos y hasta dos nombres.
  select * into r from public.search_workout_sessions(p_query => 'domin');
  assert r.muscle_groups = '["Pecho", "Espalda"]'::jsonb and r.exercise_names = '["Press de banca", "Dominadas"]'::jsonb
         and r.exercise_count = 2 and r.set_count = 4, format('Resumen de la sesión: %s', row_to_json(r));

  -- Páginas: el cursor continúa sin repetir ni saltar (también dentro del mismo día).
  select * into r from public.search_workout_sessions(p_limit => 1);
  assert r.id = '50000000-0000-0000-0000-000000000003' and r.total_count = 3, 'Primera página';
  select * into r from public.search_workout_sessions(p_before_date => r.session_date, p_before_created => r.created_at,
                                                      p_before_id => r.id, p_limit => 1);
  assert r.id = '50000000-0000-0000-0000-000000000002' and r.total_count is null, 'Segunda página';
  select * into r from public.search_workout_sessions(p_query => 'press', p_before_date => r.session_date,
                                                      p_before_created => r.created_at, p_before_id => r.id);
  assert r.id = '50000000-0000-0000-0000-000000000001', 'La búsqueda sigue en las páginas siguientes';
end $$;
delete from public.workout_sessions where id = '50000000-0000-0000-0000-000000000003';
reset role;

-- Sesiones vacías y «Última vez» -----------------------------------------------------
-- 004 (10/11): Press con decimales y una serie sin peso; 005 (12/11): Press sin series
-- (como «Repetir ejercicios»); 006: sesión que se vacía.
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select from public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000004", "session_date": "2026-11-10",
  "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a",
    "sets": [{"reps": 12, "weight_kg": 40}, {"reps": 10, "weight_kg": 42.75}, {"reps": 15, "weight_kg": null}]}]}'::jsonb);
select from public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000005", "session_date": "2026-11-12",
  "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": []}]}'::jsonb);
do $$
declare r record; ok boolean;
begin
  -- La sesión sin series se salta: la referencia es la del 10/11, con orden, decimales y peso corporal.
  select * into r from public.get_previous_exercise_sets(array['e0000000-0000-0000-0000-00000000000a']::uuid[], '2026-11-15', null);
  assert r.session_id = '50000000-0000-0000-0000-000000000004' and r.session_date = '2026-11-10',
    format('«Última vez» debe saltar la sesión sin series: %s', row_to_json(r));
  assert r.sets = '[{"reps": 12, "weight_kg": 40.00}, {"reps": 10, "weight_kg": 42.75}, {"reps": 15, "weight_kg": null}]'::jsonb,
    format('Series de referencia exactas: %s', r.sets);
  -- Excluir la sesión en edición y no hay otra con series antes → sin historial.
  assert not exists (select 1 from public.get_previous_exercise_sets(
    array['e0000000-0000-0000-0000-00000000000a']::uuid[], '2026-11-15', '50000000-0000-0000-0000-000000000004')),
    'Sin sesión anterior con series → sin historial';
  -- Solo la sesión vacía antes de la fecha → sin historial.
  assert not exists (select 1 from public.get_previous_exercise_sets(
    array['e0000000-0000-0000-0000-00000000000a']::uuid[], '2026-11-13', '50000000-0000-0000-0000-000000000004')),
    'Una sesión sin series no es referencia';
  -- Orden cronológico intacto: con fecha posterior gana la más reciente con series (26/11 > 18/11 > 10/11).
  assert (select session_date from public.get_previous_exercise_sets(
    array['e0000000-0000-0000-0000-00000000000a']::uuid[], '2030-01-01', null)) = '2026-11-26', 'La más reciente con series';

  -- Una sesión en curso puede quedar vacía en el servidor y retomarse.
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000006", "session_date": "2026-11-27",
    "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": [{"reps": 5, "weight_kg": 20}]}]}'::jsonb);
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000006", "session_date": "2026-11-27", "exercises": []}'::jsonb);
  assert (select count(*) from public.session_exercises where session_id = '50000000-0000-0000-0000-000000000006') = 0,
    'La sesión en curso queda vacía';
  assert jsonb_array_length(public.get_workout_session('50000000-0000-0000-0000-000000000006') -> 'exercises') = 0, 'Detalle vacío';

  -- No se puede finalizar vacía.
  ok := false;
  begin
    perform public.finish_workout_session('50000000-0000-0000-0000-000000000006');
  exception when check_violation then ok := true;
  end;
  assert ok, 'Finalizar exige al menos un ejercicio';
  assert (select finished_at is null from public.workout_sessions where id = '50000000-0000-0000-0000-000000000006'), 'Sigue en curso';

  -- Retomar: agregar un ejercicio y finalizar.
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000006", "session_date": "2026-11-27",
    "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": [{"reps": 6, "weight_kg": 20}]}]}'::jsonb);
  perform public.finish_workout_session('50000000-0000-0000-0000-000000000006');

  -- Finalizada: vaciarla se rechaza y los datos quedan intactos.
  ok := false;
  begin
    perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000006", "session_date": "2026-11-27", "exercises": []}'::jsonb);
  exception when check_violation then ok := true;
  end;
  assert ok, 'Una sesión finalizada no puede quedar vacía';
  assert (select count(*) from public.exercise_sets es join public.session_exercises se on se.id = es.session_exercise_id
          where se.session_id = '50000000-0000-0000-0000-000000000006') = 1, 'El rechazo no tocó los datos';
  -- Finalizada: reemplazar el ejercicio (sin series) sí se acepta.
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000006", "session_date": "2026-11-27",
    "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000b", "sets": []}]}'::jsonb);
  assert (select exercise_id from public.session_exercises where session_id = '50000000-0000-0000-0000-000000000006')
         = 'e0000000-0000-0000-0000-00000000000b', 'Reemplazo aplicado';
end $$;
delete from public.workout_sessions where id in ('50000000-0000-0000-0000-000000000004',
  '50000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000006');
reset role;

-- «Mis rutinas» -----------------------------------------------------------------------
-- Rutina R1 «Pecho y tríceps»: Fondos (3 × 8–12) y Press de banca (sin metas).
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into public.exercises (id, name, muscle_group_id) values
  ('e0000000-0000-0000-0000-00000000000c', 'Fondos', 'triceps');
do $$
declare r jsonb; ok boolean; v_err text;
begin
  -- Validaciones al crear.
  foreach r in array array[
    '{"id": "70000000-0000-0000-0000-0000000000f1", "name": "  ", "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a"}]}',
    '{"id": "70000000-0000-0000-0000-0000000000f1", "name": "Vacía", "exercises": []}',
    '{"id": "70000000-0000-0000-0000-0000000000f1", "name": "Archivado", "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000b"}]}',
    '{"id": "70000000-0000-0000-0000-0000000000f1", "name": "Mín > máx", "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "target_reps_min": 12, "target_reps_max": 8}]}',
    '{"id": "70000000-0000-0000-0000-0000000000f1", "name": "Series 0", "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "target_sets": 0}]}',
    '{"id": "70000000-0000-0000-0000-0000000000f1", "name": "Repetido", "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a"}, {"exercise_id": "e0000000-0000-0000-0000-00000000000a"}]}'
  ]::jsonb[] loop
    ok := false;
    begin
      perform public.save_routine(r);
    exception when check_violation or unique_violation then ok := true;
    end;
    assert ok, format('La rutina inválida debe rechazarse: %s', r ->> 'name');
  end loop;
  assert not exists (select 1 from public.routines), 'Los rechazos no dejan rutinas a medias';

  -- Crear (idempotente por id) y leer en orden con metas.
  for i in 1..2 loop
    perform public.save_routine('{"id": "70000000-0000-0000-0000-000000000001", "name": " Pecho y tríceps ", "exercises": [
      {"exercise_id": "e0000000-0000-0000-0000-00000000000c", "target_sets": 3, "target_reps_min": 8, "target_reps_max": 12},
      {"exercise_id": "e0000000-0000-0000-0000-00000000000a"}]}'::jsonb);
  end loop;
  assert (select count(*) from public.routines) = 1, 'Crear dos veces con el mismo id no duplica';
  select exercises into r from public.get_routines('70000000-0000-0000-0000-000000000001');
  assert (select name from public.get_routines()) = 'Pecho y tríceps', 'Nombre sin espacios sobrantes';
  assert r -> 0 ->> 'name' = 'Fondos' and (r -> 0 ->> 'target_sets')::int = 3 and (r -> 0 ->> 'target_reps_max')::int = 12
         and r -> 1 ->> 'name' = 'Press de banca' and r -> 1 -> 'target_sets' = 'null'::jsonb, format('Orden y metas: %s', r);

  -- Usar la rutina: sesión en curso, orden, metas copiadas y cero series. Idempotente.
  r := public.start_routine_session('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000007', '2026-11-27');
  assert (r ->> 'created')::boolean and r -> 'omitted' = '[]'::jsonb, format('Inicio: %s', r);
  r := public.start_routine_session('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000007', '2026-11-27');
  assert not (r ->> 'created')::boolean, 'Doble toque: no crea otra sesión';
  assert (select count(*) from public.workout_sessions where session_date = '2026-11-27') = 1, 'Una sola sesión';
  r := public.get_workout_session('50000000-0000-0000-0000-000000000007');
  assert r ->> 'finished_at' is null, 'La sesión nace en curso';
  assert r -> 'exercises' -> 0 ->> 'name' = 'Fondos' and r -> 'exercises' -> 1 ->> 'name' = 'Press de banca', 'Orden de la rutina';
  assert (r -> 'exercises' -> 0 ->> 'target_sets')::int = 3 and (r -> 'exercises' -> 0 ->> 'target_reps_min')::int = 8,
    'Metas copiadas';
  assert (select count(*) from public.exercise_sets es join public.session_exercises se on se.id = es.session_exercise_id
          where se.session_id = '50000000-0000-0000-0000-000000000007') = 0, 'Cero series registradas';
  -- Las metas no cuentan como trabajo: el progreso no incluye la sesión.
  assert not exists (select 1 from public.get_exercise_progress('e0000000-0000-0000-0000-00000000000c', null, null)),
    'Las metas no son series';

  -- Registrar series conserva las metas (el editor no las envía).
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000007", "session_date": "2026-11-27", "exercises": [
    {"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": []},
    {"exercise_id": "e0000000-0000-0000-0000-00000000000c", "sets": [{"reps": 10, "weight_kg": null}]}]}'::jsonb);
  r := public.get_workout_session('50000000-0000-0000-0000-000000000007');
  assert r -> 'exercises' -> 1 ->> 'name' = 'Fondos' and (r -> 'exercises' -> 1 ->> 'target_reps_max')::int = 12,
    format('Guardar conserva las metas: %s', r -> 'exercises');

  -- Editar la rutina no cambia la sesión creada con ella.
  perform public.save_routine('{"id": "70000000-0000-0000-0000-000000000001", "name": "Pecho", "exercises": [
    {"exercise_id": "e0000000-0000-0000-0000-00000000000a", "target_sets": 5, "target_reps_min": 5, "target_reps_max": 5}]}'::jsonb);
  r := public.get_workout_session('50000000-0000-0000-0000-000000000007');
  assert jsonb_array_length(r -> 'exercises') = 2 and r -> 'exercises' -> 0 -> 'target_sets' = 'null'::jsonb
         and (r -> 'exercises' -> 1 ->> 'target_sets')::int = 3, 'Editar la rutina no toca la sesión';

  -- Ejercicio archivado después de guardar: se puede mantener al editar, se omite al usar.
  perform public.save_routine('{"id": "70000000-0000-0000-0000-000000000002", "name": "Con archivado", "exercises": [
    {"exercise_id": "e0000000-0000-0000-0000-00000000000c"}, {"exercise_id": "e0000000-0000-0000-0000-00000000000a"}]}'::jsonb);
  update public.exercises set archived_at = now() where id = 'e0000000-0000-0000-0000-00000000000c';
  assert (select (exercises -> 0 ->> 'archived')::boolean from public.get_routines('70000000-0000-0000-0000-000000000002')),
    'La plantilla identifica el ejercicio archivado';
  perform public.save_routine('{"id": "70000000-0000-0000-0000-000000000002", "name": "Con archivado 2", "exercises": [
    {"exercise_id": "e0000000-0000-0000-0000-00000000000c"}, {"exercise_id": "e0000000-0000-0000-0000-00000000000a"}]}'::jsonb);
  r := public.start_routine_session('70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000008', '2026-11-27');
  assert r -> 'omitted' = '["Fondos"]'::jsonb, format('Omite archivados: %s', r);
  assert jsonb_array_length(public.get_workout_session('50000000-0000-0000-0000-000000000008') -> 'exercises') = 1, 'Solo activos';
  -- Todos archivados: no inicia.
  perform public.save_routine('{"id": "70000000-0000-0000-0000-000000000002", "name": "Solo archivado", "exercises": [
    {"exercise_id": "e0000000-0000-0000-0000-00000000000c"}]}'::jsonb);
  ok := false;
  begin
    perform public.start_routine_session('70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000009', '2026-11-27');
  exception when check_violation then ok := true;
  end;
  assert ok and not exists (select 1 from public.workout_sessions where id = '50000000-0000-0000-0000-000000000009'),
    'Con todo archivado no se crea la sesión';
  update public.exercises set archived_at = null where id = 'e0000000-0000-0000-0000-00000000000c';

  -- Eliminar la rutina conserva las sesiones creadas con ella.
  delete from public.routines where id = '70000000-0000-0000-0000-000000000001';
  assert exists (select 1 from public.workout_sessions where id = '50000000-0000-0000-0000-000000000007'), 'La sesión se conserva';
  assert (public.get_workout_session('50000000-0000-0000-0000-000000000007') -> 'exercises' -> 1 ->> 'target_sets')::int = 3,
    'Con sus metas';
end $$;
reset role;

select from pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
do $$
declare ok boolean;
begin
  assert not exists (select 1 from public.get_routines()), 'Beto no ve rutinas de Ana';
  assert (select count(*) from public.routine_exercises) = 0, 'Ni sus ejercicios';
  ok := false;
  begin
    perform public.start_routine_session('70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-0000000000b9', '2026-11-27');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'Beto no puede usar una rutina ajena';
  ok := false;
  begin
    perform public.save_routine('{"id": "70000000-0000-0000-0000-000000000002", "name": "Robada", "exercises": [
      {"exercise_id": "e0000000-0000-0000-0000-00000000000a"}]}'::jsonb);
  exception when insufficient_privilege or foreign_key_violation then ok := true;
  end;
  assert ok, 'Beto no puede sobrescribir una rutina ajena';
  ok := false;
  begin
    perform public.save_routine('{"id": "70000000-0000-0000-0000-0000000000b2", "name": "Con ejercicio ajeno", "exercises": [
      {"exercise_id": "e0000000-0000-0000-0000-00000000000a"}]}'::jsonb);
  exception when foreign_key_violation or insufficient_privilege then ok := true;
  end;
  assert ok, 'Beto no puede usar ejercicios de Ana en sus rutinas';
  delete from public.routines;
  update public.routine_exercises set target_sets = 1;
end $$;
reset role;
do $$
begin
  assert (select name from public.routines where id = '70000000-0000-0000-0000-000000000002') = 'Solo archivado',
    'Los intentos de Beto no tuvieron efecto';
  assert not exists (select 1 from public.routines where id = '70000000-0000-0000-0000-0000000000b2'), 'Nada a medias';
  assert not exists (select 1 from public.workout_sessions where id = '50000000-0000-0000-0000-0000000000b9'), 'Sin sesión ajena';
  -- Limpieza para las pruebas siguientes (cuentan las sesiones de Ana).
  delete from public.workout_sessions where id in ('50000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000008');
  delete from public.routines;
  delete from public.exercises where id = 'e0000000-0000-0000-0000-00000000000c';
end $$;
\echo '   Mis rutinas (validación, uso, metas, archivados, aislamiento): OK'

-- «Tu constancia» ------------------------------------------------------------------------
-- Ana: 002 (26/11, finalizada, con series) cuenta; 001 (18/11, en curso) no.
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
do $$
declare r record;
begin
  select * into r from public.get_training_consistency('2026-11-01');
  assert r.total_days = 1 and r.recent_days = array['2026-11-26']::date[] and r.active_weeks = array['2026-11-23']::date[],
    format('Estado inicial: %s', row_to_json(r));

  -- Segunda sesión válida el mismo día: sigue siendo un día.
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000010", "session_date": "2026-11-26",
    "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": [{"reps": 5, "weight_kg": 50}]}]}'::jsonb);
  perform public.finish_workout_session('50000000-0000-0000-0000-000000000010');
  -- Finalizada sin series (24/11): no cuenta.
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000011", "session_date": "2026-11-24",
    "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": []}]}'::jsonb);
  perform public.finish_workout_session('50000000-0000-0000-0000-000000000011');
  -- En curso con series (16/11): no cuenta hasta finalizarla.
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000012", "session_date": "2026-11-16",
    "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": [{"reps": 8, "weight_kg": 40}]}]}'::jsonb);
  select * into r from public.get_training_consistency('2026-11-01');
  assert r.total_days = 1 and r.recent_days = array['2026-11-26']::date[], format('Mismo día, sin series y en curso: %s', row_to_json(r));

  perform public.finish_workout_session('50000000-0000-0000-0000-000000000012');
  select * into r from public.get_training_consistency('2026-11-01');
  assert r.total_days = 2 and r.recent_days = array['2026-11-26', '2026-11-16']::date[]
         and r.active_weeks = array['2026-11-23', '2026-11-16']::date[], format('Al finalizar cuenta: %s', row_to_json(r));
  -- Solo los días desde p_since; el total y las semanas son de todo el historial.
  select * into r from public.get_training_consistency('2026-11-20');
  assert r.total_days = 2 and r.recent_days = array['2026-11-26']::date[] and cardinality(r.active_weeks) = 2, 'Ventana reciente';

  -- Corregir la fecha (domingo 01/11 → semana del lunes 26/10).
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000012", "session_date": "2026-11-01",
    "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": [{"reps": 8, "weight_kg": 40}]}]}'::jsonb);
  select * into r from public.get_training_consistency('2026-11-01');
  assert r.active_weeks = array['2026-11-23', '2026-10-26']::date[] and r.recent_days = array['2026-11-26', '2026-11-01']::date[],
    format('Corregir la fecha: %s', row_to_json(r));
  -- Quitar sus series: deja de contar.
  perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000012", "session_date": "2026-11-01",
    "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": []}]}'::jsonb);
  select * into r from public.get_training_consistency('2026-11-01');
  assert r.total_days = 1 and r.active_weeks = array['2026-11-23']::date[], format('Quitar series: %s', row_to_json(r));
  -- Eliminar una de las dos del 26/11: el día sigue contando por la otra.
  delete from public.workout_sessions where id = '50000000-0000-0000-0000-000000000010';
  select * into r from public.get_training_consistency('2026-11-01');
  assert r.total_days = 1 and r.recent_days = array['2026-11-26']::date[], 'Eliminar una de dos sesiones del día';
end $$;
delete from public.workout_sessions where id in ('50000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000012');
reset role;

select from pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
do $$
declare r record;
begin
  select * into r from public.get_training_consistency('2000-01-01');
  assert r.total_days = 0 and r.recent_days = '{}'::date[] and r.active_weeks = '{}'::date[], 'La constancia es privada';
end $$;
reset role;
\echo '   Tu constancia (días distintos, válidas, fecha, series, eliminación, aislamiento): OK'

-- Series por bloques ----------------------------------------------------------------------
-- Smith inclinado: 7 a 40 → 7 a 35 → 7 a 30 kg, 1 vez por serie, 4 series.
-- Elevaciones laterales: (7 reps → sostener 7 s) × 3 por serie, 4 series.
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into public.exercises (id, name, muscle_group_id) values
  ('e0000000-0000-0000-0000-00000000000d', 'Smith inclinado', 'pecho'),
  ('e0000000-0000-0000-0000-00000000000e', 'Elevaciones laterales', 'hombros');
do $$
declare
  smith jsonb := '{"rounds": 1, "blocks": [{"type": "reps", "reps": 7, "weight_kg": 40}, {"type": "reps", "reps": 7, "weight_kg": 35}, {"type": "reps", "reps": 7, "weight_kg": 30}]}';
  lat jsonb := '{"rounds": 3, "blocks": [{"type": "reps", "reps": 7, "weight_kg": null}, {"type": "hold", "seconds": 7, "weight_kg": null}]}';
  r record; j jsonb; ok boolean; bad jsonb;
begin
  perform public.save_workout_session(jsonb_build_object('id', '50000000-0000-0000-0000-000000000013', 'session_date', '2026-11-27',
    'exercises', jsonb_build_array(
      jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-00000000000d', 'sets', jsonb_build_array(smith, smith, smith, smith)),
      jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-00000000000e', 'sets', jsonb_build_array(lat, lat, lat, lat)))));

  -- Smith: 4 series, 84 reps, máximo 40 kg × 7.
  select * into r from public.get_exercise_progress('e0000000-0000-0000-0000-00000000000d', null, null);
  assert jsonb_array_length(r.sets) = 4 and r.total_reps = 84 and r.max_weight_kg = 40 and r.max_reps = 7,
    format('Smith inclinado: %s', row_to_json(r));
  assert r.sets -> 0 = smith || '{"reps": null, "weight_kg": null}'::jsonb, format('JSON de la serie: %s', r.sets -> 0);
  select recent -> 0 into j from public.get_progress_overview() where exercise_id = 'e0000000-0000-0000-0000-00000000000d';
  assert j -> 'best_set' = '{"reps": 7, "weight_kg": 40}'::jsonb and (j ->> 'total_reps')::int = 84 and (j ->> 'set_count')::int = 4,
    format('Resumen de Smith: %s', j);

  -- Laterales: 4 series, 84 reps y 84 s de sostén.
  select * into r from public.get_exercise_progress('e0000000-0000-0000-0000-00000000000e', null, null);
  assert jsonb_array_length(r.sets) = 4 and r.total_reps = 84 and r.max_weight_kg is null, format('Laterales: %s', row_to_json(r));
  assert (select sum(private.set_hold_seconds(es.rounds, es.blocks)) from public.exercise_sets es
          join public.session_exercises se on se.id = es.session_exercise_id
          where se.session_id = '50000000-0000-0000-0000-000000000013' and se.exercise_id = 'e0000000-0000-0000-0000-00000000000e') = 84,
    '84 s de sostén';
  -- Contadores de Historial: cada serie por bloques es una serie.
  assert (select set_count from public.search_workout_sessions(p_query => 'smith')) = 8, 'Historial cuenta 8 series';

  -- «Última vez» conserva bloques, orden y ciclos.
  select * into r from public.get_previous_exercise_sets(array['e0000000-0000-0000-0000-00000000000e']::uuid[], '2026-11-28', null);
  assert r.sets -> 0 -> 'blocks' = lat -> 'blocks' and (r.sets -> 0 ->> 'rounds')::int = 3, format('Última vez: %s', r.sets -> 0);

  -- Corregir un solo bloque deja el resto igual.
  perform public.save_workout_session(jsonb_build_object('id', '50000000-0000-0000-0000-000000000013', 'session_date', '2026-11-27',
    'exercises', jsonb_build_array(
      jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-00000000000d', 'sets', jsonb_build_array(smith,
        jsonb_set(smith, '{blocks,1,weight_kg}', '37.5'), smith, smith)),
      jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-00000000000e', 'sets', jsonb_build_array(lat, lat, lat, lat)))));
  j := public.get_workout_session('50000000-0000-0000-0000-000000000013') -> 'exercises' -> 0 -> 'sets';
  assert (j -> 1 -> 'blocks' -> 1 ->> 'weight_kg')::numeric = 37.5 and j -> 1 -> 'blocks' -> 0 = smith -> 'blocks' -> 0
         and j -> 0 = j -> 2, format('Corrección de un bloque: %s', j);

  -- Validación: secuencia vacía, tipo desconocido, reps 0, sostén con reps, 3 decimales, ciclos 0.
  foreach bad in array array[
    '{"rounds": 1, "blocks": []}', '{"rounds": 1, "blocks": [{"type": "jump", "reps": 7}]}',
    '{"rounds": 1, "blocks": [{"type": "reps", "reps": 0}]}', '{"rounds": 1, "blocks": [{"type": "hold", "seconds": 7, "reps": 3}]}',
    '{"rounds": 1, "blocks": [{"type": "reps", "reps": 7, "weight_kg": 40.125}]}', '{"rounds": 0, "blocks": [{"type": "reps", "reps": 7}]}',
    '{"rounds": 1, "blocks": [{"type": "hold", "seconds": 1.5}]}'
  ]::jsonb[] loop
    ok := false;
    begin
      perform public.save_workout_session(jsonb_build_object('id', '50000000-0000-0000-0000-000000000014', 'session_date', '2026-11-27',
        'exercises', jsonb_build_array(jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-00000000000d', 'sets', jsonb_build_array(bad)))));
    exception when check_violation then ok := true;
    end;
    assert ok, format('Serie por bloques inválida aceptada: %s', bad);
  end loop;
  assert not exists (select 1 from public.workout_sessions where id = '50000000-0000-0000-0000-000000000014'), 'Sin sesiones a medias';

  -- Compatibilidad: las series simples devuelven el mismo JSON de siempre.
  assert public.get_workout_session('50000000-0000-0000-0000-000000000002') -> 'exercises' -> 0 -> 'sets' -> 0
         = '{"reps": 12, "weight_kg": 42.50}'::jsonb, 'Series simples sin cambios';

  -- Rutinas: la secuencia planificada (sin pesos) es la meta y se copia a la sesión.
  ok := false;
  begin
    perform public.save_routine('{"id": "70000000-0000-0000-0000-000000000005", "name": "Con peso en el plan", "exercises": [
      {"exercise_id": "e0000000-0000-0000-0000-00000000000e", "target_blocks": {"rounds": 3, "items": [{"type": "reps", "reps": 7, "weight_kg": 5}]}}]}'::jsonb);
  exception when check_violation then ok := true;
  end;
  assert ok, 'El plan no guarda pesos';
  perform public.save_routine('{"id": "70000000-0000-0000-0000-000000000005", "name": "Hombro", "exercises": [
    {"exercise_id": "e0000000-0000-0000-0000-00000000000e", "target_sets": 4,
     "target_blocks": {"rounds": 3, "items": [{"type": "reps", "reps": 7}, {"type": "hold", "seconds": 7}]}}]}'::jsonb);
  assert (select exercises -> 0 -> 'target_blocks' from public.get_routines('70000000-0000-0000-0000-000000000005'))
         = '{"rounds": 3, "items": [{"type": "reps", "reps": 7}, {"type": "hold", "seconds": 7}]}'::jsonb, 'Plan guardado';
  perform public.start_routine_session('70000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000015', '2026-11-28');
  j := public.get_workout_session('50000000-0000-0000-0000-000000000015') -> 'exercises' -> 0;
  assert (j -> 'target_blocks' ->> 'rounds')::int = 3 and (j ->> 'target_sets')::int = 4 and j -> 'sets' = '[]'::jsonb,
    format('El plan se copia y no cuenta como series: %s', j);
  -- Registrar los resultados reales conserva el plan.
  perform public.save_workout_session(jsonb_build_object('id', '50000000-0000-0000-0000-000000000015', 'session_date', '2026-11-28',
    'exercises', jsonb_build_array(jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-00000000000e', 'sets', jsonb_build_array(lat)))));
  j := public.get_workout_session('50000000-0000-0000-0000-000000000015') -> 'exercises' -> 0;
  assert j -> 'target_blocks' is not null and jsonb_array_length(j -> 'sets') = 1, 'Guardar conserva el plan';
end $$;
delete from public.workout_sessions where id in ('50000000-0000-0000-0000-000000000013', '50000000-0000-0000-0000-000000000015');
delete from public.routines where id = '70000000-0000-0000-0000-000000000005';
delete from public.exercises where id in ('e0000000-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-00000000000e');
reset role;
\echo '   Series por bloques (métricas, Última vez, corrección, validación, compatibilidad, rutinas): OK'

-- «Solo barra» ----------------------------------------------------------------------------
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into public.exercises (id, name, muscle_group_id) values
  ('e0000000-0000-0000-0000-00000000000f', 'Press con barra', 'pecho'),
  ('e0000000-0000-0000-0000-000000000010', 'Curl con barra', 'biceps');
do $$
declare r record; j jsonb; ok boolean;
  bloque jsonb := '{"rounds": 1, "blocks": [{"type": "reps", "reps": 7, "weight_kg": 30}, {"type": "reps", "reps": 7, "weight_kg": null, "bar_only": true}, {"type": "hold", "seconds": 7, "weight_kg": null, "bar_only": true}]}';
begin
  perform public.save_workout_session(jsonb_build_object('id', '50000000-0000-0000-0000-000000000016', 'session_date', '2026-11-27',
    'exercises', jsonb_build_array(
      jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-00000000000f', 'sets', jsonb_build_array(
        '{"reps": 10, "weight_kg": null, "bar_only": true}'::jsonb, '{"reps": 8, "weight_kg": 40}'::jsonb, bloque)),
      jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-000000000010', 'sets', jsonb_build_array(
        '{"reps": 10, "weight_kg": null, "bar_only": true}'::jsonb)))));

  -- Se guarda la marca; el peso desconocido queda null; las series sin barra no cambian su JSON.
  j := public.get_workout_session('50000000-0000-0000-0000-000000000016') -> 'exercises' -> 0 -> 'sets';
  assert j -> 0 = '{"reps": 10, "weight_kg": null, "bar_only": true}'::jsonb, format('Serie con barra: %s', j -> 0);
  assert j -> 1 = '{"reps": 8, "weight_kg": 40.00}'::jsonb, format('Serie normal sin cambios: %s', j -> 1);
  assert j -> 2 -> 'blocks' = bloque -> 'blocks', format('Bloques con barra: %s', j -> 2);

  -- Progreso: cuenta series y reps; la carga desconocida no entra en el máximo.
  select * into r from public.get_exercise_progress('e0000000-0000-0000-0000-00000000000f', null, null);
  assert jsonb_array_length(r.sets) = 3 and r.total_reps = 32 and r.max_weight_kg = 40, format('Progreso con barra: %s', row_to_json(r));
  -- Solo barra (sin peso) no lo clasifica como peso corporal.
  select * into r from public.get_progress_overview() where exercise_id = 'e0000000-0000-0000-0000-000000000010';
  assert r.uses_weight and r.session_count = 1, format('Curl con barra es con peso: %s', row_to_json(r));
  select * into r from public.get_exercise_progress('e0000000-0000-0000-0000-000000000010', null, null);
  assert r.total_reps = 10 and r.max_weight_kg is null, 'Sin peso conocido no hay máximo';
  -- «Última vez» conserva la marca.
  select * into r from public.get_previous_exercise_sets(array['e0000000-0000-0000-0000-00000000000f']::uuid[], '2026-11-28', null);
  assert (r.sets -> 0 ->> 'bar_only')::boolean and (r.sets -> 2 -> 'blocks' -> 1 ->> 'bar_only')::boolean, 'Última vez con barra';

  -- Más tarde se registra el peso real de la barra (45 kg) conservando la etiqueta: entra en el máximo.
  perform public.save_workout_session(jsonb_build_object('id', '50000000-0000-0000-0000-000000000016', 'session_date', '2026-11-27',
    'exercises', jsonb_build_array(
      jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-00000000000f', 'sets', jsonb_build_array(
        '{"reps": 10, "weight_kg": 45, "bar_only": true}'::jsonb, '{"reps": 8, "weight_kg": 40}'::jsonb, bloque)),
      jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-000000000010', 'sets', jsonb_build_array(
        '{"reps": 10, "weight_kg": null, "bar_only": true}'::jsonb)))));
  select * into r from public.get_exercise_progress('e0000000-0000-0000-0000-00000000000f', null, null);
  assert r.max_weight_kg = 45 and r.sets -> 0 = '{"reps": 10, "weight_kg": 45.00, "bar_only": true}'::jsonb
         and r.sets -> 1 = '{"reps": 8, "weight_kg": 40.00}'::jsonb, format('Peso real de la barra: %s', row_to_json(r));
  select recent -> 0 -> 'best_set' into j from public.get_progress_overview() where exercise_id = 'e0000000-0000-0000-0000-00000000000f';
  assert j = '{"reps": 10, "weight_kg": 45, "bar_only": true}'::jsonb, format('Mejor serie con barra: %s', j);

  -- Validación: bar_only debe ser booleano.
  ok := false;
  begin
    perform public.save_workout_session(jsonb_build_object('id', '50000000-0000-0000-0000-000000000017', 'session_date', '2026-11-27',
      'exercises', jsonb_build_array(jsonb_build_object('exercise_id', 'e0000000-0000-0000-0000-00000000000f', 'sets', jsonb_build_array(
        '{"rounds": 1, "blocks": [{"type": "reps", "reps": 7, "bar_only": "sí"}]}'::jsonb)))));
  exception when check_violation then ok := true;
  end;
  assert ok, 'bar_only inválido rechazado';
end $$;
delete from public.workout_sessions where id = '50000000-0000-0000-0000-000000000016';
delete from public.exercises where id in ('e0000000-0000-0000-0000-00000000000f', 'e0000000-0000-0000-0000-000000000010');
reset role;
\echo '   Solo barra (guardado, compatibilidad, Progreso, clasificación, peso posterior): OK'

select from pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
do $$
declare ok boolean := false;
begin
  begin
    perform public.finish_workout_session('50000000-0000-0000-0000-000000000001');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'No se puede finalizar una sesión ajena';
  assert not exists (select 1 from public.get_home_sessions('2000-01-01', 3)), 'Inicio es privado';
  assert not exists (select 1 from public.search_workout_sessions()), 'El historial es privado';
end $$;
reset role;
do $$
begin
  assert (select finished_at is null from public.workout_sessions where id = '50000000-0000-0000-0000-000000000001'),
    'El intento ajeno no tuvo efecto';
end $$;
\echo '   Estado de sesión, Inicio, Historial, sesiones vacías y «Última vez»: OK'

-- 3. Beto no ve ni toca nada de Ana --------------------------------------------
select from pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
do $$
declare ok boolean;
begin
  assert (select count(*) from public.exercises) = 0, 'Beto no debe ver ejercicios de Ana';
  assert (select count(*) from public.workout_sessions) = 0, 'Beto no debe ver sesiones de Ana';
  assert (select count(*) from public.session_exercises) = 0, 'Beto no debe ver ejercicios de sesión de Ana';
  assert (select count(*) from public.exercise_sets) = 0, 'Beto no debe ver series de Ana';
  assert (select count(*) from public.profiles) = 1, 'Beto solo ve su perfil';
  assert public.get_workout_session('50000000-0000-0000-0000-000000000001') is null, 'Acceso directo por id bloqueado';
  assert (select count(*) from public.get_exercise_progress('e0000000-0000-0000-0000-00000000000a', null, null)) = 0,
    'Progreso ajeno bloqueado';
  assert not exists (select 1 from public.get_previous_exercise_sets(
    array['e0000000-0000-0000-0000-00000000000a']::uuid[], '2030-01-01', null)), 'Series ajenas bloqueadas';

  update public.exercises set name = 'Hackeado' where id = 'e0000000-0000-0000-0000-00000000000a';
  delete from public.workout_sessions where id = '50000000-0000-0000-0000-000000000001';

  -- Sobrescribir una sesión ajena reutilizando su id.
  ok := false;
  begin
    perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000001", "session_date": "2026-11-26", "exercises": []}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'No se puede sobrescribir una sesión ajena';

  -- Usar el ejercicio de Ana en una sesión propia.
  ok := false;
  begin
    perform public.save_workout_session('{"id": "50000000-0000-0000-0000-0000000000b1", "session_date": "2026-11-26",
      "exercises": [{"exercise_id": "e0000000-0000-0000-0000-00000000000a", "sets": [{"reps": 1, "weight_kg": 1}]}]}'::jsonb);
  exception when foreign_key_violation or insufficient_privilege then ok := true;
  end;
  assert ok, 'No se puede usar un ejercicio ajeno';

  -- Insertar filas con el user_id de Ana.
  ok := false;
  begin
    insert into public.exercises (user_id, name, muscle_group_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Falso', 'pecho');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'No se puede crear datos a nombre de otra persona';

  -- Escalar privilegios en su perfil.
  ok := false;
  begin
    update public.profiles set role = 'admin' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'Un usuario no puede cambiar su rol';
end $$;
reset role;

do $$
begin
  assert (select name from public.exercises where id = 'e0000000-0000-0000-0000-00000000000a') = 'Press de banca',
    'La actualización ajena no debe tener efecto';
  assert exists (select 1 from public.workout_sessions where id = '50000000-0000-0000-0000-000000000001'),
    'El borrado ajeno no debe tener efecto';
  assert (select session_date from public.workout_sessions where id = '50000000-0000-0000-0000-000000000001') = '2026-11-18',
    'La sesión de Ana sigue intacta';
end $$;

-- 4. El administrador ve perfiles pero NO datos de entrenamiento ajenos ---------
select from pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
set role authenticated;
do $$
begin
  assert (select count(*) from public.profiles) = 4, 'El admin ve todos los perfiles';
  assert (select count(*) from public.exercises) = 0, 'El admin no ve ejercicios ajenos';
  assert (select count(*) from public.workout_sessions) = 0, 'El admin no ve sesiones ajenas';
end $$;
reset role;

-- 5. Registro sin aprovisionar: sin acceso ------------------------------------
select from pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
set role authenticated;
do $$
declare ok boolean := false;
begin
  begin
    insert into public.exercises (name, muscle_group_id) values ('Sentadilla', 'cuadriceps');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'Una cuenta inactiva no puede crear datos';
end $$;
reset role;

-- 6. Desactivar a Ana corta el acceso aunque su token siga vigente --------------
update public.profiles set is_active = false where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
do $$
declare ok boolean := false;
begin
  assert (select count(*) from public.exercises) = 0, 'Cuenta desactivada: sin ejercicios';
  assert (select count(*) from public.workout_sessions) = 0, 'Cuenta desactivada: sin sesiones';
  assert public.get_workout_session('50000000-0000-0000-0000-000000000002') is null, 'Cuenta desactivada: sin detalle';
  begin
    perform public.save_workout_session('{"id": "50000000-0000-0000-0000-000000000009", "session_date": "2026-11-26", "exercises": []}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'Cuenta desactivada: no puede guardar';
end $$;
reset role;

-- Reactivar devuelve el acceso con los datos intactos.
update public.profiles set is_active = true where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
do $$
begin
  assert (select count(*) from public.workout_sessions) = 2, 'Reactivada: recupera sus sesiones';
end $$;
reset role;

-- 7. Anónimo: nada ----------------------------------------------------------------
select set_config('request.jwt.claims', '', false);
set role anon;
do $$
declare ok boolean := false;
begin
  begin
    perform count(*) from public.exercises;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anon no puede leer ejercicios';
  ok := false;
  begin
    perform public.save_workout_session('{}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anon no puede ejecutar funciones';
end $$;
reset role;

\echo '   RLS, idempotencia, decimales, historial y progreso: OK'

-- 8. Las funciones auxiliares SECURITY DEFINER no se exponen por la API -------------
do $$
begin
  assert not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname <> 'handle_new_user'
  ), 'Ninguna función SECURITY DEFINER invocable debe quedar en el esquema public';
  assert to_regprocedure('private.current_user_can_train()') is not null, 'Falta private.current_user_can_train';
  assert not has_schema_privilege('anon', 'private', 'usage'), 'anon no debe usar el esquema private';
end $$;
\echo '   Funciones auxiliares fuera de la API: OK'

-- 9. Catálogo de grupos musculares -------------------------------------------------
select from pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
do $$
declare ok boolean;
begin
  assert (select count(*) from public.muscle_groups) = 17, 'El catálogo debe tener 17 grupos';
  assert (select name from public.muscle_groups where id = 'cuadriceps') = 'Cuádriceps', 'Nombre con tilde';

  ok := false;
  begin
    insert into public.muscle_groups (id, name, region, sort_order) values ('nuevo', 'Nuevo', 'General', 999);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'Un usuario no puede agregar grupos al catálogo';

  ok := false;
  begin
    update public.muscle_groups set name = 'Hackeado' where id = 'pecho';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'Un usuario no puede modificar el catálogo';

  ok := false;
  begin
    insert into public.exercises (name, muscle_group_id) values ('Curl', 'PECHO ');
  exception when foreign_key_violation then ok := true;
  end;
  assert ok, 'Solo se aceptan ids del catálogo';

  insert into public.exercises (name, muscle_group_id) values ('Curl de bíceps', 'biceps');

  ok := false;
  begin
    insert into public.exercises (name) values ('Burpees');
  exception when check_violation or not_null_violation then ok := true;
  end;
  assert ok, 'El grupo muscular es obligatorio';
end $$;
reset role;

-- El detalle de la sesión muestra el nombre del grupo desde el catálogo.
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
do $$
begin
  assert public.get_workout_session('50000000-0000-0000-0000-000000000002') -> 'exercises' -> 0 ->> 'muscle_group' = 'Pecho',
    'get_workout_session debe devolver el nombre del grupo';
end $$;
reset role;

select set_config('request.jwt.claims', '', false);
set role anon;
do $$
declare ok boolean := false;
begin
  begin
    perform count(*) from public.muscle_groups;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anon no puede leer el catálogo';
end $$;
reset role;

do $$
begin
  assert private.muscle_group_from_text('  CUÁDRICEPS ') = 'cuadriceps', 'Conversión con tildes y espacios';
  assert private.muscle_group_from_text('gemelos') = 'pantorrillas', 'Conversión de sinónimos';
  assert private.muscle_group_from_text('Full   Body') = 'cuerpo_completo', 'Conversión de varias palabras';
  assert private.muscle_group_from_text('brazos') is null, 'Sin coincidencia devuelve null';
  assert private.muscle_group_from_text('') is null, 'Vacío devuelve null';
end $$;
\echo '   Catálogo de grupos musculares: OK'

-- 10. Borrar un ejercicio con historial está bloqueado; borrar la cuenta completa funciona.
select from pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
do $$
declare ok boolean := false;
begin
  begin
    delete from public.exercises where id = 'e0000000-0000-0000-0000-00000000000a';
  exception when foreign_key_violation then ok := true;
  end;
  assert ok, 'No se debe poder borrar un ejercicio con historial (se archiva)';
end $$;
reset role;

delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
begin
  assert not exists (select 1 from public.workout_sessions where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'Borrar la cuenta borra sus sesiones';
  assert not exists (select 1 from public.exercises where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'Borrar la cuenta borra sus ejercicios';
end $$;
\echo '   Borrado de cuentas con historial: OK'
