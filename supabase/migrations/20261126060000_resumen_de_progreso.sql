-- Resumen de progreso por ejercicio, para la lista de «Progreso» en una sola consulta.
--
-- Por cada ejercicio con registros devuelve:
--   * uses_weight: si alguna vez tuvo series con peso (la clasificación peso /
--     peso corporal se toma de todo el historial, no del rango elegido);
--   * session_count, last_session_date, last_session_id: actividad reciente;
--   * recent: las dos sesiones comparables más recientes (de la más nueva a la
--     más vieja) con su mejor serie. Para ejercicios con peso solo cuentan las
--     sesiones con alguna serie con peso; la mejor serie es la de mayor peso y,
--     si hay empate, la de más repeticiones. Para peso corporal, la de más reps.
-- Dos sesiones del mismo día se ordenan por su hora de creación.

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
  with per_session as (
    select
      se.exercise_id,
      ws.id as session_id,
      ws.session_date,
      ws.created_at,
      max(es.weight_kg) as max_weight,
      sum(es.reps)::integer as total_reps,
      count(*)::integer as set_count,
      (array_agg(jsonb_build_object('reps', es.reps, 'weight_kg', es.weight_kg)
                 order by es.weight_kg desc nulls last, es.reps desc))[1] as best_set
    from public.workout_sessions ws
    join public.session_exercises se on se.session_id = ws.id
    join public.exercise_sets es on es.session_exercise_id = se.id
    where ws.user_id = auth.uid()
    group by se.exercise_id, ws.id, ws.session_date, ws.created_at
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
    where not c.uses_weight or c.max_weight is not null
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

revoke execute on function public.get_progress_overview() from public, anon;
grant execute on function public.get_progress_overview() to authenticated;
