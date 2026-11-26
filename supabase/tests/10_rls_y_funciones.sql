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
