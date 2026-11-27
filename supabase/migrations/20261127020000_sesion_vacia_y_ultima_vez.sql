-- 1) Sesiones sin ejercicios: una sesión EN CURSO puede quedar vacía (el usuario
--    quitó su último ejercicio y la retomará después); una sesión FINALIZADA debe
--    conservar al menos un ejercicio, y finalizar exige al menos uno.
-- 2) «Última vez»: la sesión anterior de referencia es la más reciente que tenga al
--    menos una serie del ejercicio (se saltan las creadas con «Repetir ejercicios»
--    que quedaron sin series).
--
-- Compatible con la app anterior: nunca envía sesiones vacías ni finaliza sesiones
-- sin ejercicios, y las firmas de las funciones no cambian.

-- Guarda una sesión completa de forma atómica e idempotente (mismo contrato que
-- antes). Nuevo: si la sesión ya está finalizada, no acepta dejarla sin ejercicios.
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

  -- Si el id ya existe y es de otra persona, RLS rechaza la actualización.
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

  -- Una sesión finalizada no puede quedar vacía (la transacción se revierte entera).
  if v_finished_at is not null and jsonb_array_length(p_session -> 'exercises') = 0 then
    raise exception 'Una sesión finalizada necesita al menos un ejercicio'
      using errcode = '23514', hint = 'finished_session_needs_exercise';
  end if;

  -- Reemplaza el contenido: las series borradas o reordenadas quedan exactas.
  delete from public.session_exercises where session_id = v_id;

  for v_ex, v_ex_pos in
    select e.value, e.ordinality
    from jsonb_array_elements(p_session -> 'exercises') with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_ex -> 'sets') is distinct from 'array' then
      raise exception 'Formato de series inválido' using errcode = '22023';
    end if;

    insert into public.session_exercises (session_id, user_id, exercise_id, position)
    values (v_id, v_uid, (v_ex ->> 'exercise_id')::uuid, v_ex_pos - 1)
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

-- Finaliza una sesión propia. Idempotente: conserva la primera fecha de cierre.
-- Nuevo: exige al menos un ejercicio.
create or replace function public.finish_workout_session(p_session_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_finished_at timestamptz;
begin
  if not exists (select 1 from public.workout_sessions where id = p_session_id) then
    raise exception 'Sesión no encontrada' using errcode = '42501';
  end if;
  if not exists (select 1 from public.session_exercises where session_id = p_session_id) then
    raise exception 'Agrega al menos un ejercicio para finalizar la sesión'
      using errcode = '23514', hint = 'finish_needs_exercise';
  end if;

  update public.workout_sessions
  set finished_at = coalesce(finished_at, now())
  where id = p_session_id
  returning finished_at into v_finished_at;

  if v_finished_at is null then
    raise exception 'Sesión no encontrada' using errcode = '42501';
  end if;
  return jsonb_build_object('id', p_session_id, 'finished_at', v_finished_at);
end;
$$;

-- Series de la sesión anterior más reciente (antes de p_before) que tenga al menos
-- una serie del ejercicio. El filtro se aplica ANTES de elegir la sesión, así las
-- sesiones con el ejercicio pero sin series se saltan. Mismo orden cronológico
-- (fecha y hora de creación), misma exclusión de la sesión en edición, y RLS.
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
      select jsonb_agg(jsonb_build_object('reps', es.reps, 'weight_kg', es.weight_kg)
                       order by se2.position, es.position)
      from public.session_exercises se2
      join public.exercise_sets es on es.session_exercise_id = se2.id
      where se2.session_id = l.session_id and se2.exercise_id = l.exercise_id
    ), '[]'::jsonb)
  from latest l;
$$;
