-- «Mis rutinas»: plantillas personales de entrenamiento.
--
-- * routines / routine_exercises: la plantilla (nombre, ejercicios en orden y metas
--   opcionales de series y repeticiones). Mismo aislamiento por usuario que el resto.
-- * session_exercises.target_*: copia de las metas al iniciar una sesión con una
--   rutina. Editar o borrar la rutina después no cambia la sesión.
-- * save_routine: guarda la rutina completa de forma atómica e idempotente (id del cliente).
-- * start_routine_session: crea la sesión y sus ejercicios en una sola operación,
--   idempotente por el id de sesión que genera el cliente (doble toque / reintento).
-- * save_workout_session conserva las metas de cada ejercicio al reemplazar su contenido.
-- * get_workout_session incluye las metas.
--
-- Compatible con la app anterior: tablas y columnas nuevas (nulas), funciones nuevas,
-- y las existentes mantienen su firma y su contrato.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index routines_user_idx on public.routines (user_id, updated_at desc);

create trigger routines_set_updated_at
before update on public.routines
for each row execute function public.set_updated_at();

create table public.routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null,
  user_id uuid not null default auth.uid(),
  exercise_id uuid not null,
  position integer not null check (position >= 0),
  target_sets integer check (target_sets is null or target_sets between 1 and 20),
  target_reps_min integer check (target_reps_min is null or target_reps_min between 1 and 1000),
  target_reps_max integer check (target_reps_max is null or target_reps_max between 1 and 1000),
  created_at timestamptz not null default now(),
  -- Repeticiones: ninguna, una cantidad (mín = máx) o un rango (mín ≤ máx).
  check ((target_reps_min is null) = (target_reps_max is null)),
  check (target_reps_min is null or target_reps_min <= target_reps_max),
  unique (routine_id, position),
  -- Un ejercicio no se repite dentro de la misma rutina.
  unique (routine_id, exercise_id),
  foreign key (routine_id, user_id) references public.routines (id, user_id) on delete cascade,
  -- Si un ejercicio sin historial se borrara, sale de las rutinas (archivar lo conserva).
  foreign key (exercise_id, user_id) references public.exercises (id, user_id) on delete cascade
);

create index routine_exercises_routine_user_idx on public.routine_exercises (routine_id, user_id);
create index routine_exercises_exercise_user_idx on public.routine_exercises (exercise_id, user_id);

-- Metas copiadas en la sesión al iniciarla con una rutina (solo informativas).
alter table public.session_exercises
  add column target_sets integer check (target_sets is null or target_sets between 1 and 20),
  add column target_reps_min integer check (target_reps_min is null or target_reps_min between 1 and 1000),
  add column target_reps_max integer check (target_reps_max is null or target_reps_max between 1 and 1000),
  add constraint session_exercises_target_reps_check
    check ((target_reps_min is null) = (target_reps_max is null)
           and (target_reps_min is null or target_reps_min <= target_reps_max));

-- ---------------------------------------------------------------------------
-- Row Level Security (igual que el resto de los datos de entrenamiento)
-- ---------------------------------------------------------------------------

alter table public.routines enable row level security;
alter table public.routine_exercises enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['routines', 'routine_exercises']
  loop
    execute format(
      'create policy "dueño activo: leer" on public.%I for select to authenticated
         using (user_id = (select auth.uid()) and (select private.current_user_can_train()))', t);
    execute format(
      'create policy "dueño activo: crear" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()) and (select private.current_user_can_train()))', t);
    execute format(
      'create policy "dueño activo: modificar" on public.%I for update to authenticated
         using (user_id = (select auth.uid()) and (select private.current_user_can_train()))
         with check (user_id = (select auth.uid()) and (select private.current_user_can_train()))', t);
    execute format(
      'create policy "dueño activo: borrar" on public.%I for delete to authenticated
         using (user_id = (select auth.uid()) and (select private.current_user_can_train()))', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rutinas: lectura y guardado
-- ---------------------------------------------------------------------------

-- Rutinas propias (o una sola con p_id), con sus ejercicios en orden y metas.
create or replace function public.get_routines(p_id uuid default null)
returns table (id uuid, name text, created_at timestamptz, updated_at timestamptz, exercises jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.id,
    r.name,
    r.created_at,
    r.updated_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise_id', re.exercise_id,
        'name', e.name,
        'muscle_group_id', e.muscle_group_id,
        'archived', e.archived_at is not null,
        'target_sets', re.target_sets,
        'target_reps_min', re.target_reps_min,
        'target_reps_max', re.target_reps_max
      ) order by re.position)
      from public.routine_exercises re
      join public.exercises e on e.id = re.exercise_id
      where re.routine_id = r.id
    ), '[]'::jsonb)
  from public.routines r
  where r.user_id = auth.uid()
    and (p_id is null or r.id = p_id)
  order by r.updated_at desc, r.name;
$$;

-- Guarda la rutina completa (crear o editar) de forma atómica e idempotente.
-- p_routine = { "id": uuid, "name": text,
--   "exercises": [ { "exercise_id": uuid, "target_sets": int|null,
--                    "target_reps_min": int|null, "target_reps_max": int|null } ] }
-- Reglas: nombre de 1 a 80 caracteres; al menos un ejercicio; sin repetidos; los
-- ejercicios nuevos en la rutina deben estar activos (los archivados que ya estaban
-- pueden quedarse para que la persona decida quitarlos o reemplazarlos).
create or replace function public.save_routine(p_routine jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text;
  v_saved_id uuid;
  v_previous uuid[];
  v_ex jsonb;
  v_pos bigint;
  v_exercise uuid;
  v_archived boolean;
begin
  if v_uid is null or not private.current_user_can_train() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if jsonb_typeof(p_routine) <> 'object'
     or jsonb_typeof(p_routine -> 'exercises') is distinct from 'array' then
    raise exception 'Formato de rutina inválido' using errcode = '22023';
  end if;

  v_id := (p_routine ->> 'id')::uuid;
  v_name := btrim(coalesce(p_routine ->> 'name', ''));
  if v_id is null then
    raise exception 'Falta el id de la rutina' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Escribe un nombre para la rutina' using errcode = '23514', hint = 'routine_name';
  end if;
  if jsonb_array_length(p_routine -> 'exercises') = 0 then
    raise exception 'Agrega al menos un ejercicio' using errcode = '23514', hint = 'routine_needs_exercise';
  end if;
  if jsonb_array_length(p_routine -> 'exercises') > 50 then
    raise exception 'Demasiados ejercicios' using errcode = '22023';
  end if;

  select coalesce(array_agg(re.exercise_id), '{}') into v_previous
  from public.routine_exercises re
  where re.routine_id = v_id;

  insert into public.routines as r (id, user_id, name)
  values (v_id, v_uid, v_name)
  on conflict (id) do update
    set name = excluded.name,
        updated_at = now()
    where r.user_id = v_uid
  returning r.id into v_saved_id;

  if v_saved_id is null then
    raise exception 'Rutina no encontrada' using errcode = '42501';
  end if;

  delete from public.routine_exercises where routine_id = v_id;

  for v_ex, v_pos in
    select e.value, e.ordinality
    from jsonb_array_elements(p_routine -> 'exercises') with ordinality as e(value, ordinality)
  loop
    v_exercise := (v_ex ->> 'exercise_id')::uuid;
    -- RLS: un ejercicio ajeno no es visible y la clave foránea compuesta lo rechaza.
    select e.archived_at is not null into v_archived from public.exercises e where e.id = v_exercise;
    if v_archived and not (v_exercise = any (v_previous)) then
      raise exception 'Solo puedes agregar ejercicios activos' using errcode = '23514', hint = 'routine_archived_exercise';
    end if;

    insert into public.routine_exercises
      (routine_id, user_id, exercise_id, position, target_sets, target_reps_min, target_reps_max)
    values (
      v_id, v_uid, v_exercise, v_pos - 1,
      nullif(v_ex ->> 'target_sets', '')::integer,
      nullif(v_ex ->> 'target_reps_min', '')::integer,
      nullif(v_ex ->> 'target_reps_max', '')::integer
    );
  end loop;

  return jsonb_build_object('id', v_saved_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Usar una rutina: crea la sesión en curso en una sola operación
-- ---------------------------------------------------------------------------

-- Devuelve { id, created, omitted: [nombres de ejercicios archivados] }.
-- Idempotente: si la sesión p_session_id ya existe (doble toque o reintento), la
-- devuelve sin cambios. La sesión nace en curso, con cero series, los ejercicios
-- activos en el orden de la rutina y una copia de sus metas.
create or replace function public.start_routine_session(p_routine_id uuid, p_session_id uuid, p_date date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_omitted jsonb;
  v_active integer;
begin
  if v_uid is null or not private.current_user_can_train() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_routine_id is null or p_session_id is null or p_date is null then
    raise exception 'Faltan datos para iniciar la rutina' using errcode = '22023';
  end if;

  -- Reintento: la sesión ya existe y es propia.
  if exists (select 1 from public.workout_sessions ws where ws.id = p_session_id and ws.user_id = v_uid) then
    return jsonb_build_object('id', p_session_id, 'created', false, 'omitted', '[]'::jsonb);
  end if;

  if not exists (select 1 from public.routines r where r.id = p_routine_id) then
    raise exception 'Rutina no encontrada' using errcode = '42501';
  end if;

  select
    coalesce(jsonb_agg(e.name order by re.position) filter (where e.archived_at is not null), '[]'::jsonb),
    count(*) filter (where e.archived_at is null)
  into v_omitted, v_active
  from public.routine_exercises re
  join public.exercises e on e.id = re.exercise_id
  where re.routine_id = p_routine_id;

  if v_active = 0 then
    raise exception 'Todos los ejercicios de la rutina están archivados'
      using errcode = '23514', hint = 'routine_all_archived';
  end if;

  -- Si el id existiera y fuera de otra persona, la clave primaria lo rechaza.
  insert into public.workout_sessions (id, user_id, session_date)
  values (p_session_id, v_uid, p_date);

  insert into public.session_exercises
    (session_id, user_id, exercise_id, position, target_sets, target_reps_min, target_reps_max)
  select
    p_session_id, v_uid, re.exercise_id,
    (row_number() over (order by re.position) - 1)::integer,
    re.target_sets, re.target_reps_min, re.target_reps_max
  from public.routine_exercises re
  join public.exercises e on e.id = re.exercise_id
  where re.routine_id = p_routine_id and e.archived_at is null
  order by re.position;

  return jsonb_build_object('id', p_session_id, 'created', true, 'omitted', v_omitted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sesiones: conservar y mostrar las metas
-- ---------------------------------------------------------------------------

-- Mismo contrato que antes. Nuevo: al reemplazar el contenido conserva las metas de
-- cada ejercicio (por exercise_id), que vienen de la rutina y no del editor.
create or replace function public.save_workout_session(p_session jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_date date;
  v_notes text;
  v_saved_id uuid;
  v_updated_at timestamptz;
  v_finished_at timestamptz;
  v_targets jsonb;
  v_target jsonb;
  v_ex jsonb;
  v_ex_pos bigint;
  v_set jsonb;
  v_set_pos bigint;
  v_se_id uuid;
  v_reps integer;
  v_weight numeric;
begin
  if v_uid is null or not private.current_user_can_train() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if jsonb_typeof(p_session) <> 'object'
     or jsonb_typeof(p_session -> 'exercises') is distinct from 'array' then
    raise exception 'Formato de sesión inválido' using errcode = '22023';
  end if;

  v_id := (p_session ->> 'id')::uuid;
  v_date := (p_session ->> 'session_date')::date;
  v_notes := nullif(btrim(coalesce(p_session ->> 'notes', '')), '');
  if v_id is null or v_date is null then
    raise exception 'Falta el id o la fecha de la sesión' using errcode = '22023';
  end if;

  insert into public.workout_sessions as ws (id, user_id, session_date, notes)
  values (v_id, v_uid, v_date, v_notes)
  on conflict (id) do update
    set session_date = excluded.session_date,
        notes = excluded.notes,
        updated_at = now()
    where ws.user_id = v_uid
  returning ws.id, ws.updated_at, ws.finished_at into v_saved_id, v_updated_at, v_finished_at;

  if v_saved_id is null then
    raise exception 'Sesión no encontrada' using errcode = '42501';
  end if;

  if v_finished_at is not null and jsonb_array_length(p_session -> 'exercises') = 0 then
    raise exception 'Una sesión finalizada necesita al menos un ejercicio'
      using errcode = '23514', hint = 'finished_session_needs_exercise';
  end if;

  -- Metas actuales por ejercicio (las puso la rutina al iniciar la sesión).
  select coalesce(jsonb_object_agg(se.exercise_id::text, jsonb_build_object(
           'sets', se.target_sets, 'min', se.target_reps_min, 'max', se.target_reps_max)), '{}'::jsonb)
  into v_targets
  from public.session_exercises se
  where se.session_id = v_id
    and (se.target_sets is not null or se.target_reps_min is not null);

  delete from public.session_exercises where session_id = v_id;

  for v_ex, v_ex_pos in
    select e.value, e.ordinality
    from jsonb_array_elements(p_session -> 'exercises') with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_ex -> 'sets') is distinct from 'array' then
      raise exception 'Formato de series inválido' using errcode = '22023';
    end if;

    v_target := v_targets -> (v_ex ->> 'exercise_id');
    insert into public.session_exercises
      (session_id, user_id, exercise_id, position, target_sets, target_reps_min, target_reps_max)
    values (
      v_id, v_uid, (v_ex ->> 'exercise_id')::uuid, v_ex_pos - 1,
      (v_target ->> 'sets')::integer, (v_target ->> 'min')::integer, (v_target ->> 'max')::integer
    )
    returning id into v_se_id;

    for v_set, v_set_pos in
      select s.value, s.ordinality
      from jsonb_array_elements(v_ex -> 'sets') with ordinality as s(value, ordinality)
    loop
      v_reps := (v_set ->> 'reps')::integer;
      v_weight := nullif(v_set ->> 'weight_kg', '')::numeric;
      if v_weight is not null and v_weight <> round(v_weight, 2) then
        raise exception 'El peso admite como máximo dos decimales' using errcode = '22023';
      end if;
      insert into public.exercise_sets (session_exercise_id, user_id, position, reps, weight_kg)
      values (v_se_id, v_uid, v_set_pos - 1, v_reps, v_weight);
    end loop;
  end loop;

  return jsonb_build_object('id', v_saved_id, 'updated_at', v_updated_at);
end;
$$;

-- El detalle de la sesión incluye las metas de cada ejercicio.
create or replace function public.get_workout_session(p_session_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', ws.id,
    'session_date', ws.session_date,
    'notes', ws.notes,
    'created_at', ws.created_at,
    'updated_at', ws.updated_at,
    'finished_at', ws.finished_at,
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise_id', se.exercise_id,
        'name', e.name,
        'muscle_group', mg.name,
        'archived', e.archived_at is not null,
        'target_sets', se.target_sets,
        'target_reps_min', se.target_reps_min,
        'target_reps_max', se.target_reps_max,
        'sets', coalesce((
          select jsonb_agg(jsonb_build_object('reps', es.reps, 'weight_kg', es.weight_kg)
                           order by es.position)
          from public.exercise_sets es
          where es.session_exercise_id = se.id
        ), '[]'::jsonb)
      ) order by se.position)
      from public.session_exercises se
      join public.exercises e on e.id = se.exercise_id
      left join public.muscle_groups mg on mg.id = e.muscle_group_id
      where se.session_id = ws.id
    ), '[]'::jsonb)
  )
  from public.workout_sessions ws
  where ws.id = p_session_id;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------

revoke execute on function public.get_routines(uuid) from public, anon;
revoke execute on function public.save_routine(jsonb) from public, anon;
revoke execute on function public.start_routine_session(uuid, uuid, date) from public, anon;
grant execute on function public.get_routines(uuid) to authenticated;
grant execute on function public.save_routine(jsonb) to authenticated;
grant execute on function public.start_routine_session(uuid, uuid, date) to authenticated;
