-- Historial: búsqueda por ejercicio combinada con un rango de fechas, por páginas.
--
-- Solo agrega una función nueva: es compatible con la versión anterior de la app,
-- que sigue usando list_workout_sessions.
--
-- * p_from / p_to: límites inclusivos de session_date (cualquiera puede ser null).
-- * p_query: texto a buscar en el nombre ACTUAL de los ejercicios de la sesión
--   (sin distinguir mayúsculas ni tildes). Cada sesión se devuelve una sola vez
--   aunque coincidan varios de sus ejercicios.
-- * Paginación por cursor (session_date, created_at, id) de la última fila recibida,
--   así la búsqueda recorre todo el historial filtrado y no solo lo ya cargado.
-- * total_count: total de sesiones que cumplen el filtro (solo en la primera página).

create or replace function private.search_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Se quitan las tildes antes de lower() para no depender del locale de la base.
  select lower(translate(coalesce(p_value, ''),
    'áàäâéèëêíìïîóòöôúùüûñçÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇ',
    'aaaaeeeeiiiioooouuuuncAAAAEEEEIIIIOOOOUUUUNC'));
$$;

revoke execute on function private.search_text(text) from public, anon;
grant execute on function private.search_text(text) to authenticated;

create or replace function public.search_workout_sessions(
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_before_date date default null,
  p_before_created timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid,
  session_date date,
  created_at timestamptz,
  finished_at timestamptz,
  exercise_count integer,
  set_count integer,
  muscle_groups jsonb,
  exercise_names jsonb,
  total_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select nullif(
      replace(replace(replace(private.search_text(btrim(left(p_query, 100))), '\', '\\'), '%', '\%'), '_', '\_'),
      ''
    ) as needle
  ),
  matching as (
    select ws.id, ws.session_date, ws.created_at, ws.finished_at
    from public.workout_sessions ws, params
    where ws.user_id = auth.uid()
      and (p_from is null or ws.session_date >= p_from)
      and (p_to is null or ws.session_date <= p_to)
      and (
        params.needle is null
        or exists (
          select 1
          from public.session_exercises se
          join public.exercises e on e.id = se.exercise_id
          where se.session_id = ws.id
            and private.search_text(e.name) like '%' || params.needle || '%' escape '\'
        )
      )
  ),
  page as (
    select m.*, case when p_before_id is null then (count(*) over ())::integer end as total_count
    from matching m
    order by m.session_date desc, m.created_at desc, m.id desc
  )
  select
    p.id,
    p.session_date,
    p.created_at,
    p.finished_at,
    (select count(*)::integer from public.session_exercises se where se.session_id = p.id),
    (select count(*)::integer
       from public.session_exercises se
       join public.exercise_sets es on es.session_exercise_id = se.id
      where se.session_id = p.id),
    coalesce((
      select jsonb_agg(g.name order by g.first_position)
      from (
        select mg.name, min(se.position) as first_position
        from public.session_exercises se
        join public.exercises e on e.id = se.exercise_id
        join public.muscle_groups mg on mg.id = e.muscle_group_id
        where se.session_id = p.id
        group by mg.name
      ) g
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(x.name order by x.position)
      from (
        select e.name, se.position
        from public.session_exercises se
        join public.exercises e on e.id = se.exercise_id
        where se.session_id = p.id
        order by se.position
        limit 2
      ) x
    ), '[]'::jsonb),
    p.total_count
  from page p
  where p_before_id is null
     or (p.session_date, p.created_at, p.id) < (p_before_date, p_before_created, p_before_id)
  order by p.session_date desc, p.created_at desc, p.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

revoke execute on function public.search_workout_sessions(date, date, text, date, timestamptz, uuid, integer) from public, anon;
grant execute on function public.search_workout_sessions(date, date, text, date, timestamptz, uuid, integer) to authenticated;
