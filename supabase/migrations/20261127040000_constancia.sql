-- «Tu constancia»: indicadores de días entrenados para Inicio, en una sola consulta.
--
-- Un día cuenta como entrenado si tiene al menos una sesión FINALIZADA con al menos
-- una serie registrada; se cuentan fechas de entrenamiento distintas (dos sesiones
-- válidas el mismo día suman un día). Todo se calcula desde los datos actuales, así
-- que finalizar, cambiar la fecha, quitar series o eliminar una sesión se refleja solo.
--
-- Devuelve:
--   * total_days: días entrenados en todo el historial;
--   * recent_days: días entrenados desde p_since (para la franja de la semana; el
--     cliente decide qué es «hoy» y la semana con la fecha local);
--   * active_weeks: lunes de cada semana (lunes a domingo) con al menos un día
--     entrenado, de la más reciente a la más antigua (para la racha semanal).
--
-- Solo agrega una función: compatible con la app anterior.

create or replace function public.get_training_consistency(p_since date)
returns table (total_days integer, recent_days date[], active_weeks date[])
language sql
stable
security invoker
set search_path = ''
as $$
  with trained as (
    select distinct ws.session_date as day
    from public.workout_sessions ws
    where ws.user_id = auth.uid()
      and ws.finished_at is not null
      and exists (
        select 1
        from public.session_exercises se
        join public.exercise_sets es on es.session_exercise_id = se.id
        where se.session_id = ws.id
      )
  )
  select
    (select count(*)::integer from trained),
    coalesce((select array_agg(t.day order by t.day desc) from trained t where t.day >= p_since), '{}'::date[]),
    coalesce((
      select array_agg(w.week order by w.week desc)
      from (select distinct date_trunc('week', t.day::timestamp)::date as week from trained t) w
    ), '{}'::date[]);
$$;

revoke execute on function public.get_training_consistency(date) from public, anon;
grant execute on function public.get_training_consistency(date) to authenticated;
