-- Series por bloques.
--
-- Una serie puede ser SIMPLE (reps y peso opcional, como hasta ahora) o POR BLOQUES:
-- una secuencia ordenada de bloques que se repite `rounds` veces dentro de la serie.
--   * Bloque «reps»: {"type": "reps", "reps": 7, "weight_kg": 40 | null}
--   * Bloque «hold» (sostener): {"type": "hold", "seconds": 7, "weight_kg": 5 | null}
-- Cada serie por bloques cuenta como UNA serie. Sus reps totales = rounds × Σ reps de
-- los bloques «reps»; el tiempo de sostén (rounds × Σ segundos) se calcula aparte. Para
-- el peso máximo cuenta la carga de los bloques «reps» y las reps que lo acompañan son
-- las de ese bloque.
--
-- Rutinas: la meta de un ejercicio puede incluir la secuencia planificada (sin pesos;
-- los pesos se toman de «Última vez»): {"rounds": 3, "items": [{"type": "reps", "reps": 7},
-- {"type": "hold", "seconds": 7}]}. Se copia a la sesión al usar la rutina.
--
-- Compatible con la app anterior: las series simples no cambian; columnas nuevas nulas;
-- las funciones mantienen su firma y, para series simples, el mismo JSON.

-- ---------------------------------------------------------------------------
-- Validación y métricas (funciones inmutables, usadas por restricciones y consultas)
-- ---------------------------------------------------------------------------

create or replace function private.valid_set_blocks(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  b jsonb;
  w numeric;
  n numeric;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and 20 then return false; end if;
  for b in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(b) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(b) k where k not in ('type', 'reps', 'seconds', 'weight_kg')) then
      return false;
    end if;
    if b ->> 'type' = 'reps' then
      if jsonb_typeof(b -> 'reps') is distinct from 'number' or b ? 'seconds' then return false; end if;
      n := (b ->> 'reps')::numeric;
      if n <> trunc(n) or n not between 1 and 1000 then return false; end if;
    elsif b ->> 'type' = 'hold' then
      if jsonb_typeof(b -> 'seconds') is distinct from 'number' or b ? 'reps' then return false; end if;
      n := (b ->> 'seconds')::numeric;
      if n <> trunc(n) or n not between 1 and 3600 then return false; end if;
    else
      return false;
    end if;
    if b ? 'weight_kg' and jsonb_typeof(b -> 'weight_kg') <> 'null' then
      if jsonb_typeof(b -> 'weight_kg') <> 'number' then return false; end if;
      w := (b ->> 'weight_kg')::numeric;
      if w < 0 or w > 2000 or w <> round(w, 2) then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;

-- Secuencia planificada de una rutina (sin pesos).
create or replace function private.valid_block_plan(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  b jsonb;
  n numeric;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'items') is distinct from 'array'
     or jsonb_typeof(p -> 'rounds') is distinct from 'number' then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('rounds', 'items')) then return false; end if;
  n := (p ->> 'rounds')::numeric;
  if n <> trunc(n) or n not between 1 and 50 then return false; end if;
  if jsonb_array_length(p -> 'items') not between 1 and 20 then return false; end if;
  for b in select value from jsonb_array_elements(p -> 'items') loop
    if jsonb_typeof(b) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(b) k where k not in ('type', 'reps', 'seconds')) then return false; end if;
    if b ->> 'type' = 'reps' then
      if jsonb_typeof(b -> 'reps') is distinct from 'number' or b ? 'seconds' then return false; end if;
      n := (b ->> 'reps')::numeric;
      if n <> trunc(n) or n not between 1 and 1000 then return false; end if;
    elsif b ->> 'type' = 'hold' then
      if jsonb_typeof(b -> 'seconds') is distinct from 'number' or b ? 'reps' then return false; end if;
      n := (b ->> 'seconds')::numeric;
      if n <> trunc(n) or n not between 1 and 3600 then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Reps totales de una serie (simple: sus reps; por bloques: rounds × Σ reps).
create or replace function private.set_total_reps(p_reps integer, p_rounds integer, p_blocks jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_blocks is null then p_reps
    else p_rounds * coalesce((
      select sum((b ->> 'reps')::integer) from jsonb_array_elements(p_blocks) b where b ->> 'type' = 'reps'
    ), 0)::integer
  end;
$$;

-- Segundos de sostén de una serie (0 en las simples).
create or replace function private.set_hold_seconds(p_rounds integer, p_blocks jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_blocks is null then 0
    else p_rounds * coalesce((
      select sum((b ->> 'seconds')::integer) from jsonb_array_elements(p_blocks) b where b ->> 'type' = 'hold'
    ), 0)::integer
  end;
$$;

-- Mejor serie {reps, weight_kg}: simple → la serie; por bloques → el bloque «reps» de
-- mayor peso (empate → más reps). Null si la serie no tiene bloques de repeticiones.
create or replace function private.set_best(p_reps integer, p_weight numeric, p_blocks jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_blocks is null then jsonb_build_object('reps', p_reps, 'weight_kg', p_weight)
    else (
      select jsonb_build_object('reps', (b ->> 'reps')::integer, 'weight_kg', (b ->> 'weight_kg')::numeric)
      from jsonb_array_elements(p_blocks) b
      where b ->> 'type' = 'reps'
      order by (b ->> 'weight_kg')::numeric desc nulls last, (b ->> 'reps')::integer desc
      limit 1
    )
  end;
$$;

-- JSON de una serie: igual que antes para las simples; con rounds y blocks para las demás.
create or replace function private.set_json(p_reps integer, p_weight numeric, p_rounds integer, p_blocks jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_blocks is null then jsonb_build_object('reps', p_reps, 'weight_kg', p_weight)
    else jsonb_build_object('reps', null, 'weight_kg', null, 'rounds', p_rounds, 'blocks', p_blocks)
  end;
$$;

revoke execute on function private.valid_set_blocks(jsonb) from public, anon;
revoke execute on function private.valid_block_plan(jsonb) from public, anon;
revoke execute on function private.set_total_reps(integer, integer, jsonb) from public, anon;
revoke execute on function private.set_hold_seconds(integer, jsonb) from public, anon;
revoke execute on function private.set_best(integer, numeric, jsonb) from public, anon;
revoke execute on function private.set_json(integer, numeric, integer, jsonb) from public, anon;
grant execute on function private.valid_set_blocks(jsonb) to authenticated;
grant execute on function private.valid_block_plan(jsonb) to authenticated;
grant execute on function private.set_total_reps(integer, integer, jsonb) to authenticated;
grant execute on function private.set_hold_seconds(integer, jsonb) to authenticated;
grant execute on function private.set_best(integer, numeric, jsonb) to authenticated;
grant execute on function private.set_json(integer, numeric, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

alter table public.exercise_sets
  alter column reps drop not null,
  add column rounds integer,
  add column blocks jsonb,
  add constraint exercise_sets_kind_check check (
    (blocks is null and rounds is null and reps is not null)
    or (blocks is not null and reps is null and weight_kg is null
        and rounds between 1 and 50 and private.valid_set_blocks(blocks))
  );

alter table public.routine_exercises
  add column target_blocks jsonb check (private.valid_block_plan(target_blocks));

alter table public.session_exercises
  add column target_blocks jsonb check (private.valid_block_plan(target_blocks));

-- ---------------------------------------------------------------------------
-- Sesiones
-- ---------------------------------------------------------------------------

-- Mismo contrato. Nuevo: una serie con "blocks" (array) se guarda por bloques, con
-- "rounds" (1 por defecto); se conservan también las metas por bloques de la rutina.
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
           'sets', se.target_sets, 'min', se.target_reps_min, 'max', se.target_reps_max,
           'blocks', se.target_blocks)), '{}'::jsonb)
  into v_targets
  from public.session_exercises se
  where se.session_id = v_id
    and (se.target_sets is not null or se.target_reps_min is not null or se.target_blocks is not null);

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
      (session_id, user_id, exercise_id, position, target_sets, target_reps_min, target_reps_max, target_blocks)
    values (
      v_id, v_uid, (v_ex ->> 'exercise_id')::uuid, v_ex_pos - 1,
      (v_target ->> 'sets')::integer, (v_target ->> 'min')::integer, (v_target ->> 'max')::integer,
      nullif(v_target -> 'blocks', 'null'::jsonb)
    )
    returning id into v_se_id;

    for v_set, v_set_pos in
      select s.value, s.ordinality
      from jsonb_array_elements(v_ex -> 'sets') with ordinality as s(value, ordinality)
    loop
      if jsonb_typeof(v_set -> 'blocks') = 'array' then
        -- Serie por bloques: la restricción valida la secuencia, los pesos y los ciclos.
        insert into public.exercise_sets (session_exercise_id, user_id, position, reps, weight_kg, rounds, blocks)
        values (v_se_id, v_uid, v_set_pos - 1, null, null,
                coalesce((v_set ->> 'rounds')::integer, 1), v_set -> 'blocks');
      else
        v_reps := (v_set ->> 'reps')::integer;
        v_weight := nullif(v_set ->> 'weight_kg', '')::numeric;
        if v_weight is not null and v_weight <> round(v_weight, 2) then
          raise exception 'El peso admite como máximo dos decimales' using errcode = '22023';
        end if;
        insert into public.exercise_sets (session_exercise_id, user_id, position, reps, weight_kg)
        values (v_se_id, v_uid, v_set_pos - 1, v_reps, v_weight);
      end if;
    end loop;
  end loop;

  return jsonb_build_object('id', v_saved_id, 'updated_at', v_updated_at);
end;
$$;

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
        'target_blocks', se.target_blocks,
        'sets', coalesce((
          select jsonb_agg(private.set_json(es.reps, es.weight_kg, es.rounds, es.blocks) order by es.position)
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

-- «Última vez»: misma regla (la sesión anterior más reciente con series); las series
-- por bloques conservan sus bloques, su orden y sus ciclos.
create or replace function public.get_previous_exercise_sets(
  p_exercise_ids uuid[],
  p_before date,
  p_exclude_session uuid default null
)
returns table (exercise_id uuid, session_id uuid, session_date date, sets jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with latest as (
    select distinct on (se.exercise_id)
      se.exercise_id, ws.id as session_id, ws.session_date
    from public.session_exercises se
    join public.workout_sessions ws on ws.id = se.session_id
    where ws.user_id = auth.uid()
      and se.exercise_id = any (p_exercise_ids)
      and ws.session_date < p_before
      and (p_exclude_session is null or ws.id <> p_exclude_session)
      and exists (select 1 from public.exercise_sets es where es.session_exercise_id = se.id)
    order by se.exercise_id, ws.session_date desc, ws.created_at desc
  )
  select
    l.exercise_id,
    l.session_id,
    l.session_date,
    coalesce((
      select jsonb_agg(private.set_json(es.reps, es.weight_kg, es.rounds, es.blocks) order by se2.position, es.position)
      from public.session_exercises se2
      join public.exercise_sets es on es.session_exercise_id = se2.id
      where se2.session_id = l.session_id and se2.exercise_id = l.exercise_id
    ), '[]'::jsonb)
  from latest l;
$$;

-- ---------------------------------------------------------------------------
-- Progreso
-- ---------------------------------------------------------------------------

create or replace function public.get_exercise_progress(
  p_exercise_id uuid,
  p_from date default null,
  p_to date default null
)
returns table (
  session_id uuid,
  session_date date,
  created_at timestamptz,
  max_weight_kg numeric,
  max_reps integer,
  total_reps integer,
  sets jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ws.id,
    ws.session_date,
    ws.created_at,
    max((private.set_best(es.reps, es.weight_kg, es.blocks) ->> 'weight_kg')::numeric),
    max((private.set_best(es.reps, es.weight_kg, es.blocks) ->> 'reps')::integer),
    sum(private.set_total_reps(es.reps, es.rounds, es.blocks))::integer,
    jsonb_agg(private.set_json(es.reps, es.weight_kg, es.rounds, es.blocks) order by se.position, es.position)
  from public.workout_sessions ws
  join public.session_exercises se on se.session_id = ws.id
  join public.exercise_sets es on es.session_exercise_id = se.id
  where ws.user_id = auth.uid()
    and se.exercise_id = p_exercise_id
    and (p_from is null or ws.session_date >= p_from)
    and (p_to is null or ws.session_date <= p_to)
  group by ws.id, ws.session_date, ws.created_at
  order by ws.session_date asc, ws.created_at asc;
$$;

-- Igual que antes, con la mejor serie y las reps calculadas también para series por bloques.
create or replace function public.get_progress_overview()
returns table (
  exercise_id uuid,
  uses_weight boolean,
  session_count integer,
  last_session_date date,
  last_session_id uuid,
  recent jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sets as (
    select
      se.exercise_id,
      ws.id as session_id,
      ws.session_date,
      ws.created_at,
      private.set_best(es.reps, es.weight_kg, es.blocks) as best,
      private.set_total_reps(es.reps, es.rounds, es.blocks) as total_reps
    from public.workout_sessions ws
    join public.session_exercises se on se.session_id = ws.id
    join public.exercise_sets es on es.session_exercise_id = se.id
    where ws.user_id = auth.uid()
  ),
  per_session as (
    select
      s.exercise_id,
      s.session_id,
      s.session_date,
      s.created_at,
      max((s.best ->> 'weight_kg')::numeric) as max_weight,
      sum(s.total_reps)::integer as total_reps,
      count(*)::integer as set_count,
      (array_agg(s.best order by (s.best ->> 'weight_kg')::numeric desc nulls last, (s.best ->> 'reps')::integer desc)
        filter (where s.best is not null))[1] as best_set
    from sets s
    group by s.exercise_id, s.session_id, s.session_date, s.created_at
  ),
  classified as (
    select
      ps.*,
      bool_or(ps.max_weight is not null) over (partition by ps.exercise_id) as uses_weight,
      count(*) over (partition by ps.exercise_id) as session_count,
      row_number() over (partition by ps.exercise_id order by ps.session_date desc, ps.created_at desc) as rn_all
    from per_session ps
  ),
  comparable as (
    select
      c.*,
      row_number() over (partition by c.exercise_id order by c.session_date desc, c.created_at desc) as rn
    from classified c
    where (not c.uses_weight and c.best_set is not null) or c.max_weight is not null
  )
  select
    c.exercise_id,
    c.uses_weight,
    c.session_count::integer,
    c.session_date,
    c.session_id,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_id', x.session_id,
        'session_date', x.session_date,
        'best_set', x.best_set,
        'total_reps', x.total_reps,
        'set_count', x.set_count
      ) order by x.rn)
      from comparable x
      where x.exercise_id = c.exercise_id and x.rn <= 2
    ), '[]'::jsonb)
  from classified c
  where c.rn_all = 1;
$$;

-- ---------------------------------------------------------------------------
-- Rutinas: secuencia planificada como meta
-- ---------------------------------------------------------------------------

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
        'target_reps_max', re.target_reps_max,
        'target_blocks', re.target_blocks
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
    select e.archived_at is not null into v_archived from public.exercises e where e.id = v_exercise;
    if v_archived and not (v_exercise = any (v_previous)) then
      raise exception 'Solo puedes agregar ejercicios activos' using errcode = '23514', hint = 'routine_archived_exercise';
    end if;

    insert into public.routine_exercises
      (routine_id, user_id, exercise_id, position, target_sets, target_reps_min, target_reps_max, target_blocks)
    values (
      v_id, v_uid, v_exercise, v_pos - 1,
      nullif(v_ex ->> 'target_sets', '')::integer,
      nullif(v_ex ->> 'target_reps_min', '')::integer,
      nullif(v_ex ->> 'target_reps_max', '')::integer,
      case when jsonb_typeof(v_ex -> 'target_blocks') = 'object' then v_ex -> 'target_blocks' end
    );
  end loop;

  return jsonb_build_object('id', v_saved_id);
end;
$$;

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

  insert into public.workout_sessions (id, user_id, session_date)
  values (p_session_id, v_uid, p_date);

  insert into public.session_exercises
    (session_id, user_id, exercise_id, position, target_sets, target_reps_min, target_reps_max, target_blocks)
  select
    p_session_id, v_uid, re.exercise_id,
    (row_number() over (order by re.position) - 1)::integer,
    re.target_sets, re.target_reps_min, re.target_reps_max, re.target_blocks
  from public.routine_exercises re
  join public.exercises e on e.id = re.exercise_id
  where re.routine_id = p_routine_id and e.archived_at is null
  order by re.position;

  return jsonb_build_object('id', p_session_id, 'created', true, 'omitted', v_omitted);
end;
$$;
