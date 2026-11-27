-- Carga explícita: «Peso corporal».
--
-- El selector de «Carga» del editor ofrece «Con peso», «Solo barra» y «Peso corporal».
-- «Solo barra» ya se guarda (bar_only). Para que «Peso corporal» elegido explícitamente
-- se distinga de un registro anterior con el peso vacío (cuyo significado no se sabe y
-- no se reasigna), se guarda también:
--   * serie simple: columna exercise_sets.bodyweight (por defecto false);
--   * bloque de una serie por bloques: clave "bodyweight": true en el bloque.
-- Con peso corporal el peso es null y no puede combinarse con «Solo barra».
-- Las métricas no cambian (sin carga, como hasta ahora).
--
-- Compatible con la app anterior: columna nueva con valor por defecto; el JSON de las
-- series solo agrega "bodyweight" cuando es verdadero; las funciones mantienen su firma.

alter table public.exercise_sets
  add column bodyweight boolean not null default false,
  add constraint exercise_sets_bodyweight_check
    check (not bodyweight or (blocks is null and not bar_only and weight_kg is null));

-- Bloques: se admite "bodyweight" (booleano, sin peso y sin «Solo barra»).
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
    if exists (select 1 from jsonb_object_keys(b) k
               where k not in ('type', 'reps', 'seconds', 'weight_kg', 'bar_only', 'bodyweight')) then
      return false;
    end if;
    if b ? 'bar_only' and jsonb_typeof(b -> 'bar_only') <> 'boolean' then return false; end if;
    if b ? 'bodyweight' and jsonb_typeof(b -> 'bodyweight') <> 'boolean' then return false; end if;
    if coalesce((b ->> 'bodyweight')::boolean, false) and (
         coalesce((b ->> 'bar_only')::boolean, false)
         or (b ? 'weight_kg' and jsonb_typeof(b -> 'weight_kg') <> 'null')) then
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

-- JSON de una serie: "bar_only" / "bodyweight" solo aparecen cuando son verdaderos.
create or replace function private.set_json(
  p_reps integer, p_weight numeric, p_rounds integer, p_blocks jsonb, p_bar_only boolean, p_bodyweight boolean
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_blocks is null then
      jsonb_build_object('reps', p_reps, 'weight_kg', p_weight)
      || case when p_bar_only then '{"bar_only": true}'::jsonb else '{}'::jsonb end
      || case when p_bodyweight then '{"bodyweight": true}'::jsonb else '{}'::jsonb end
    else jsonb_build_object('reps', null, 'weight_kg', null, 'rounds', p_rounds, 'blocks', p_blocks)
  end;
$$;

revoke execute on function private.set_json(integer, numeric, integer, jsonb, boolean, boolean) from public, anon;
grant execute on function private.set_json(integer, numeric, integer, jsonb, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Guardar: serie simple con "bodyweight"
-- ---------------------------------------------------------------------------

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
        insert into public.exercise_sets (session_exercise_id, user_id, position, reps, weight_kg, rounds, blocks)
        values (v_se_id, v_uid, v_set_pos - 1, null, null,
                coalesce((v_set ->> 'rounds')::integer, 1), v_set -> 'blocks');
      else
        v_reps := (v_set ->> 'reps')::integer;
        v_weight := nullif(v_set ->> 'weight_kg', '')::numeric;
        if v_weight is not null and v_weight <> round(v_weight, 2) then
          raise exception 'El peso admite como máximo dos decimales' using errcode = '22023';
        end if;
        insert into public.exercise_sets (session_exercise_id, user_id, position, reps, weight_kg, bar_only, bodyweight)
        values (v_se_id, v_uid, v_set_pos - 1, v_reps, v_weight,
                coalesce((v_set ->> 'bar_only')::boolean, false),
                coalesce((v_set ->> 'bodyweight')::boolean, false));
      end if;
    end loop;
  end loop;

  return jsonb_build_object('id', v_saved_id, 'updated_at', v_updated_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Lecturas con la marca de peso corporal
-- ---------------------------------------------------------------------------

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
          select jsonb_agg(private.set_json(es.reps, es.weight_kg, es.rounds, es.blocks, es.bar_only, es.bodyweight)
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
      select jsonb_agg(private.set_json(es.reps, es.weight_kg, es.rounds, es.blocks, es.bar_only, es.bodyweight)
                       order by se2.position, es.position)
      from public.session_exercises se2
      join public.exercise_sets es on es.session_exercise_id = se2.id
      where se2.session_id = l.session_id and se2.exercise_id = l.exercise_id
    ), '[]'::jsonb)
  from latest l;
$$;

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
    max((private.set_best(es.reps, es.weight_kg, es.blocks, es.bar_only) ->> 'weight_kg')::numeric),
    max((private.set_best(es.reps, es.weight_kg, es.blocks, es.bar_only) ->> 'reps')::integer),
    sum(private.set_total_reps(es.reps, es.rounds, es.blocks))::integer,
    jsonb_agg(private.set_json(es.reps, es.weight_kg, es.rounds, es.blocks, es.bar_only, es.bodyweight)
              order by se.position, es.position)
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
