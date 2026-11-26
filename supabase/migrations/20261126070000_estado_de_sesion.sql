-- Estado de la sesión: en curso o finalizada.
--
-- Hasta ahora «Finalizar sesión» solo guardaba y navegaba; no quedaba registro de
-- que la sesión había terminado. Se agrega finished_at:
--   * null  → en curso (se puede retomar desde Inicio);
--   * fecha → finalizada (se sigue pudiendo abrir y corregir).
-- Las sesiones anteriores a esta migración se tratan como registros históricos
-- finalizados. Corregir una sesión no cambia su estado.

alter table public.workout_sessions add column finished_at timestamptz;

update public.workout_sessions
set finished_at = greatest(created_at, updated_at)
where finished_at is null;

create index workout_sessions_unfinished_idx
on public.workout_sessions (user_id, session_date desc, created_at desc)
where finished_at is null;

-- Finaliza una sesión propia. Idempotente: conserva la primera fecha de cierre.
create or replace function public.finish_workout_session(p_session_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_finished_at timestamptz;
begin
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

revoke execute on function public.finish_workout_session(uuid) from public, anon;
grant execute on function public.finish_workout_session(uuid) to authenticated;

-- El detalle de la sesión incluye su estado.
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

-- Historial: agrega el estado (columna nueva al final; los clientes anteriores la ignoran).
drop function public.list_workout_sessions(date, date, integer);
create function public.list_workout_sessions(
  p_from date default null,
  p_to date default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  session_date date,
  created_at timestamptz,
  exercise_count integer,
  set_count integer,
  exercises jsonb,
  finished_at timestamptz
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
    (select count(*)::integer from public.session_exercises se where se.session_id = ws.id),
    (select count(*)::integer
       from public.session_exercises se
       join public.exercise_sets es on es.session_exercise_id = se.id
      where se.session_id = ws.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', e.name,
        'sets', (select count(*) from public.exercise_sets es where es.session_exercise_id = se.id)
      ) order by se.position)
      from public.session_exercises se
      join public.exercises e on e.id = se.exercise_id
      where se.session_id = ws.id
    ), '[]'::jsonb),
    ws.finished_at
  from public.workout_sessions ws
  where ws.user_id = auth.uid()
    and (p_from is null or ws.session_date >= p_from)
    and (p_to is null or ws.session_date <= p_to)
  order by ws.session_date desc, ws.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke execute on function public.list_workout_sessions(date, date, integer) from public, anon;
grant execute on function public.list_workout_sessions(date, date, integer) to authenticated;

-- Inicio en una sola consulta: sesiones desde p_from (semana), las que siguen en
-- curso (cualquier fecha) y las p_recent últimas finalizadas, con sus grupos
-- musculares (en el orden de la sesión) y conteos de ejercicios y series.
create or replace function public.get_home_sessions(p_from date, p_recent integer default 3)
returns table (
  id uuid,
  session_date date,
  created_at timestamptz,
  finished_at timestamptz,
  exercise_count integer,
  set_count integer,
  muscle_groups jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recent_finished as (
    select ws.id
    from public.workout_sessions ws
    where ws.user_id = auth.uid() and ws.finished_at is not null
    order by ws.session_date desc, ws.created_at desc
    limit greatest(0, least(coalesce(p_recent, 3), 20))
  )
  select
    ws.id,
    ws.session_date,
    ws.created_at,
    ws.finished_at,
    (select count(*)::integer from public.session_exercises se where se.session_id = ws.id),
    (select count(*)::integer
       from public.session_exercises se
       join public.exercise_sets es on es.session_exercise_id = se.id
      where se.session_id = ws.id),
    coalesce((
      select jsonb_agg(g.name order by g.first_position)
      from (
        select mg.name, min(se.position) as first_position
        from public.session_exercises se
        join public.exercises e on e.id = se.exercise_id
        join public.muscle_groups mg on mg.id = e.muscle_group_id
        where se.session_id = ws.id
        group by mg.name
      ) g
    ), '[]'::jsonb)
  from public.workout_sessions ws
  where ws.user_id = auth.uid()
    and (
      ws.session_date >= p_from
      or ws.finished_at is null
      or ws.id in (select rf.id from recent_finished rf)
    )
  order by ws.session_date desc, ws.created_at desc
  limit 200;
$$;

revoke execute on function public.get_home_sessions(date, integer) from public, anon;
grant execute on function public.get_home_sessions(date, integer) to authenticated;
