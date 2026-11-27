-- Entrenamiento guiado, cambio de ejercicio y series alternadas.
--
-- * session_exercises.completed: el ejercicio se marcó como finalizado («✓ Completado»),
--   aunque tenga menos series que la meta. Se puede reabrir.
-- * session_exercises.alt_group / alt_slot y routine_exercises.alt_group / alt_slot:
--   series alternadas. Los ejercicios con el mismo alt_group se hacen por turnos
--   (Press 1 → Poleas 1 → Press 2 → …). alt_slot (0 o 1) es el turno dentro de la pareja;
--   al cambiar un ejercicio que ya tiene series, el sustituto comparte el turno del
--   original y toma sus series pendientes.
-- * workout_sessions.guided_started_at / guided_exercise_id: el modo guiado se inició y
--   en qué ejercicio quedó (para retomarlo al recargar o desde otro dispositivo).
-- * save_workout_session acepta, por ejercicio, "target" (meta de esta sesión; p. ej.,
--   la del sustituto o las series de cada ejercicio alternado), "completed", "alt_group"
--   y "alt_slot", y en la sesión "guided". Si una clave no viene (app anterior), se
--   conserva el valor guardado, como ya ocurría con las metas.
-- * get_workout_session los devuelve; get_routines, save_routine y start_routine_session
--   conservan las parejas de una rutina.
--
-- Compatible con la app anterior: columnas nuevas con valores por defecto o nulas; las
-- funciones mantienen su firma y su contrato (solo agregan claves al JSON).

alter table public.session_exercises
  add column completed boolean not null default false,
  add column alt_group smallint check (alt_group is null or alt_group between 1 and 50),
  add column alt_slot smallint check (alt_slot is null or alt_slot in (0, 1)),
  add constraint session_exercises_alt_check check ((alt_group is null) = (alt_slot is null));

alter table public.routine_exercises
  add column alt_group smallint check (alt_group is null or alt_group between 1 and 50),
  add column alt_slot smallint check (alt_slot is null or alt_slot in (0, 1)),
  add constraint routine_exercises_alt_check check ((alt_group is null) = (alt_slot is null));

alter table public.workout_sessions
  add column guided_started_at timestamptz,
  add column guided_exercise_id uuid;

-- ---------------------------------------------------------------------------
-- Guardar la sesión
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
  v_previous jsonb;
  v_prev jsonb;
  v_target jsonb;
  v_ex jsonb;
  v_ex_pos bigint;
  v_set jsonb;
  v_set_pos bigint;
  v_se_id uuid;
  v_reps integer;
  v_weight numeric;
  v_completed boolean;
  v_alt_group smallint;
  v_alt_slot smallint;
begin
  if v_uid is null or not private.current_user_can_train() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if jsonb_typeof(p_session) <> 'object'
     or jsonb_typeof(p_session -> 'exercises') is distinct from 'array' then
    raise exception 'Formato de sesión inválido' using errcode = '22023';
  end if;
  if p_session ? 'guided' and jsonb_typeof(p_session -> 'guided') not in ('object', 'null') then
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

  -- Modo guiado: solo cambia si la clave viene (la app anterior no la envía).
  if p_session ? 'guided' then
    update public.workout_sessions ws
    set guided_started_at = case
          when coalesce((p_session -> 'guided' ->> 'started')::boolean, false)
            then coalesce(ws.guided_started_at, now())
        end,
        guided_exercise_id = nullif(p_session -> 'guided' ->> 'exercise_id', '')::uuid
    where ws.id = v_id;
  end if;

  if v_finished_at is not null and jsonb_array_length(p_session -> 'exercises') = 0 then
    raise exception 'Una sesión finalizada necesita al menos un ejercicio'
      using errcode = '23514', hint = 'finished_session_needs_exercise';
  end if;

  -- Lo guardado de cada ejercicio que el cliente no envía (app anterior): metas,
  -- completado y pareja alternada.
  select coalesce(jsonb_object_agg(se.exercise_id::text, jsonb_build_object(
           'sets', se.target_sets, 'min', se.target_reps_min, 'max', se.target_reps_max,
           'blocks', se.target_blocks, 'completed', se.completed,
           'alt_group', se.alt_group, 'alt_slot', se.alt_slot)), '{}'::jsonb)
  into v_previous
  from public.session_exercises se
  where se.session_id = v_id;

  delete from public.session_exercises where session_id = v_id;

  for v_ex, v_ex_pos in
    select e.value, e.ordinality
    from jsonb_array_elements(p_session -> 'exercises') with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_ex -> 'sets') is distinct from 'array' then
      raise exception 'Formato de series inválido' using errcode = '22023';
    end if;

    v_prev := coalesce(v_previous -> (v_ex ->> 'exercise_id'), '{}'::jsonb);
    if v_ex ? 'target' then
      if jsonb_typeof(v_ex -> 'target') not in ('object', 'null') then
        raise exception 'Formato de meta inválido' using errcode = '22023';
      end if;
      v_target := coalesce(nullif(v_ex -> 'target', 'null'::jsonb), '{}'::jsonb);
    else
      v_target := v_prev;
    end if;
    v_completed := case when v_ex ? 'completed' then coalesce((v_ex ->> 'completed')::boolean, false)
                        else coalesce((v_prev ->> 'completed')::boolean, false) end;
    if v_ex ? 'alt_group' then
      v_alt_group := nullif(v_ex ->> 'alt_group', '')::smallint;
      v_alt_slot := nullif(v_ex ->> 'alt_slot', '')::smallint;
    else
      v_alt_group := nullif(v_prev ->> 'alt_group', '')::smallint;
      v_alt_slot := nullif(v_prev ->> 'alt_slot', '')::smallint;
    end if;

    insert into public.session_exercises
      (session_id, user_id, exercise_id, position, target_sets, target_reps_min, target_reps_max, target_blocks,
       completed, alt_group, alt_slot)
    values (
      v_id, v_uid, (v_ex ->> 'exercise_id')::uuid, v_ex_pos - 1,
      (v_target ->> 'sets')::integer, (v_target ->> 'min')::integer, (v_target ->> 'max')::integer,
      case when jsonb_typeof(v_target -> 'blocks') = 'object' then v_target -> 'blocks' end,
      v_completed, v_alt_group, v_alt_slot
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
-- Leer la sesión (con completado, pareja y modo guiado)
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
    'guided_started_at', ws.guided_started_at,
    'guided_exercise_id', ws.guided_exercise_id,
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise_id', se.exercise_id,
        'name', e.name,
        'muscle_group', mg.name,
        'muscle_group_id', e.muscle_group_id,
        'archived', e.archived_at is not null,
        'target_sets', se.target_sets,
        'target_reps_min', se.target_reps_min,
        'target_reps_max', se.target_reps_max,
        'target_blocks', se.target_blocks,
        'completed', se.completed,
        'alt_group', se.alt_group,
        'alt_slot', se.alt_slot,
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

-- ---------------------------------------------------------------------------
-- Rutinas: parejas alternadas
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
        'target_blocks', re.target_blocks,
        'alt_group', re.alt_group,
        'alt_slot', re.alt_slot
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
      (routine_id, user_id, exercise_id, position, target_sets, target_reps_min, target_reps_max, target_blocks,
       alt_group, alt_slot)
    values (
      v_id, v_uid, v_exercise, v_pos - 1,
      nullif(v_ex ->> 'target_sets', '')::integer,
      nullif(v_ex ->> 'target_reps_min', '')::integer,
      nullif(v_ex ->> 'target_reps_max', '')::integer,
      case when jsonb_typeof(v_ex -> 'target_blocks') = 'object' then v_ex -> 'target_blocks' end,
      nullif(v_ex ->> 'alt_group', '')::smallint,
      nullif(v_ex ->> 'alt_slot', '')::smallint
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

  -- Una pareja que pierde un ejercicio archivado deja de alternarse.
  insert into public.session_exercises
    (session_id, user_id, exercise_id, position, target_sets, target_reps_min, target_reps_max, target_blocks,
     alt_group, alt_slot)
  select
    p_session_id, v_uid, re.exercise_id,
    (row_number() over (order by re.position) - 1)::integer,
    re.target_sets, re.target_reps_min, re.target_reps_max, re.target_blocks,
    case when complete_pair then re.alt_group end,
    case when complete_pair then re.alt_slot end
  from (
    select re.*,
      re.alt_group is not null and (
        select count(distinct re2.alt_slot)
        from public.routine_exercises re2
        join public.exercises e2 on e2.id = re2.exercise_id
        where re2.routine_id = re.routine_id and re2.alt_group = re.alt_group and e2.archived_at is null
      ) = 2 as complete_pair
    from public.routine_exercises re
  ) re
  join public.exercises e on e.id = re.exercise_id
  where re.routine_id = p_routine_id and e.archived_at is null
  order by re.position;

  return jsonb_build_object('id', p_session_id, 'created', true, 'omitted', v_omitted);
end;
$$;
