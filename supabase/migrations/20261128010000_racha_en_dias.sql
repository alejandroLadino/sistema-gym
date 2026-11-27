-- «Tu constancia»: el fueguito acumula los días entrenados de la racha.
--
-- La racha sigue siendo semanal (semanas seguidas con al menos un día entrenado), pero
-- el indicador del fueguito muestra cuántos días se entrenaron durante esa racha. Para
-- sumarlos sin traer todo el historial, la función devuelve además los días entrenados
-- de cada semana activa (`active_week_days`, en el mismo orden que `active_weeks`).
--
-- Compatible con la app anterior: solo agrega una columna al resultado (los clientes
-- anteriores la ignoran). Cambiar el tipo de retorno obliga a recrear la función.

drop function public.get_training_consistency(date);

create function public.get_training_consistency(p_since date)
returns table (total_days integer, recent_days date[], active_weeks date[], active_week_days integer[])
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
  ),
  weeks as (
    select date_trunc('week', t.day::timestamp)::date as week, count(*)::integer as days
    from trained t
    group by 1
  )
  select
    (select count(*)::integer from trained),
    coalesce((select array_agg(t.day order by t.day desc) from trained t where t.day >= p_since), '{}'::date[]),
    coalesce((select array_agg(w.week order by w.week desc) from weeks w), '{}'::date[]),
    coalesce((select array_agg(w.days order by w.week desc) from weeks w), '{}'::integer[]);
$$;

revoke execute on function public.get_training_consistency(date) from public, anon;
grant execute on function public.get_training_consistency(date) to authenticated;
