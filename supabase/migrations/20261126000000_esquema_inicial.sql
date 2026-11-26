-- SISTEMA GYM · esquema inicial
-- Perfiles con rol y estado, catálogo personal de ejercicios, sesiones,
-- ejercicios por sesión y series. Todo protegido con Row Level Security.

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  role text not null default 'user' check (role in ('admin', 'user')),
  -- Las cuentas nacen inactivas salvo que las haya aprovisionado el servidor
  -- (panel de administración o script del primer administrador).
  is_active boolean not null default false,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Crea el perfil al crear el usuario en Supabase Auth. El rol y la activación
-- solo se leen de raw_app_meta_data, que únicamente puede escribir service_role.
-- Un registro público (si alguien lo habilitara por error) queda inactivo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role, is_active, must_change_password)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    case when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin' else 'user' end,
    coalesce(new.raw_app_meta_data ->> 'provisioned', '') = 'true',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ¿Puede la persona autenticada usar sus datos de entrenamiento?
-- Se evalúa en cada consulta: desactivar una cuenta corta el acceso aunque
-- su token siga vigente. Con contraseña temporal pendiente tampoco hay acceso.
create or replace function public.current_user_can_train()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and not p.must_change_password
  );
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

create policy "perfil propio o administrador"
on public.profiles for select
to authenticated
using (id = (select auth.uid()) or (select public.current_user_is_admin()));

-- Los perfiles solo se modifican desde el servidor con service_role.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Ejercicios (catálogo personal)
-- ---------------------------------------------------------------------------

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  muscle_group text check (muscle_group is null or char_length(muscle_group) <= 60),
  notes text check (notes is null or char_length(notes) <= 1000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Permite claves foráneas compuestas que garantizan el mismo dueño.
  unique (id, user_id)
);

-- Un solo ejercicio activo con el mismo nombre por persona.
create unique index exercises_user_active_name_key
on public.exercises (user_id, lower(btrim(name)))
where archived_at is null;

create index exercises_user_idx on public.exercises (user_id, archived_at, name);

create trigger exercises_set_updated_at
before update on public.exercises
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Sesiones de entrenamiento
-- ---------------------------------------------------------------------------

create table public.workout_sessions (
  -- El id lo genera el cliente: guardar dos veces el mismo id no duplica.
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  session_date date not null,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index workout_sessions_user_date_idx
on public.workout_sessions (user_id, session_date desc, created_at desc);

create trigger workout_sessions_set_updated_at
before update on public.workout_sessions
for each row execute function public.set_updated_at();

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null default auth.uid(),
  exercise_id uuid not null,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (session_id, position),
  foreign key (session_id, user_id)
    references public.workout_sessions (id, user_id) on delete cascade,
  -- Archivar no borra; borrar un ejercicio con historial queda bloqueado.
  foreign key (exercise_id, user_id)
    references public.exercises (id, user_id) on delete restrict
);

create index session_exercises_exercise_idx on public.session_exercises (exercise_id, session_id);

create table public.exercise_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null,
  user_id uuid not null default auth.uid(),
  position integer not null check (position >= 0),
  reps integer not null check (reps between 1 and 1000),
  -- Peso en kg con hasta dos decimales; vacío para peso corporal.
  weight_kg numeric(6, 2) check (weight_kg is null or (weight_kg >= 0 and weight_kg <= 2000)),
  created_at timestamptz not null default now(),
  unique (session_exercise_id, position),
  foreign key (session_exercise_id, user_id)
    references public.session_exercises (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Row Level Security de los datos de entrenamiento
-- ---------------------------------------------------------------------------

alter table public.exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.exercise_sets enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['exercises', 'workout_sessions', 'session_exercises', 'exercise_sets']
  loop
    execute format(
      'create policy "dueño activo: leer" on public.%I for select to authenticated
         using (user_id = (select auth.uid()) and (select public.current_user_can_train()))', t);
    execute format(
      'create policy "dueño activo: crear" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()) and (select public.current_user_can_train()))', t);
    execute format(
      'create policy "dueño activo: modificar" on public.%I for update to authenticated
         using (user_id = (select auth.uid()) and (select public.current_user_can_train()))
         with check (user_id = (select auth.uid()) and (select public.current_user_can_train()))', t);
    execute format(
      'create policy "dueño activo: borrar" on public.%I for delete to authenticated
         using (user_id = (select auth.uid()) and (select public.current_user_can_train()))', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Funciones (RPC). Todas SECURITY INVOKER: RLS se aplica con el usuario real.
-- ---------------------------------------------------------------------------

-- Guarda una sesión completa de forma atómica e idempotente.
-- p_session = {
--   "id": uuid, "session_date": "YYYY-MM-DD", "notes": text|null,
--   "exercises": [ { "exercise_id": uuid, "sets": [ { "reps": int, "weight_kg": number|null } ] } ]
-- }
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
  v_ex jsonb;
  v_ex_pos bigint;
  v_set jsonb;
  v_set_pos bigint;
  v_se_id uuid;
  v_reps integer;
  v_weight numeric;
begin
  if v_uid is null or not public.current_user_can_train() then
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
  returning ws.id, ws.updated_at into v_saved_id, v_updated_at;

  if v_saved_id is null then
    raise exception 'Sesión no encontrada' using errcode = '42501';
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

-- Sesión completa para mostrarla o editarla. Devuelve null si no es visible.
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
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise_id', se.exercise_id,
        'name', e.name,
        'muscle_group', e.muscle_group,
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
      where se.session_id = ws.id
    ), '[]'::jsonb)
  )
  from public.workout_sessions ws
  where ws.id = p_session_id;
$$;

-- Historial: sesiones en un rango de fechas (ambos extremos opcionales).
create or replace function public.list_workout_sessions(
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
  exercises jsonb
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
    ), '[]'::jsonb)
  from public.workout_sessions ws
  where ws.user_id = auth.uid()
    and (p_from is null or ws.session_date >= p_from)
    and (p_to is null or ws.session_date <= p_to)
  order by ws.session_date desc, ws.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- Últimas series de cada ejercicio en la sesión más reciente anterior a p_before.
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

-- Progreso de un ejercicio: una fila por sesión con sus series y máximos.
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
    max(es.weight_kg),
    max(es.reps),
    sum(es.reps)::integer,
    jsonb_agg(jsonb_build_object('reps', es.reps, 'weight_kg', es.weight_kg)
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

-- Permisos de ejecución: nada para anónimos.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.current_user_can_train() from public, anon;
revoke execute on function public.current_user_is_admin() from public, anon;
revoke execute on function public.save_workout_session(jsonb) from public, anon;
revoke execute on function public.get_workout_session(uuid) from public, anon;
revoke execute on function public.list_workout_sessions(date, date, integer) from public, anon;
revoke execute on function public.get_previous_exercise_sets(uuid[], date, uuid) from public, anon;
revoke execute on function public.get_exercise_progress(uuid, date, date) from public, anon;

grant execute on function public.current_user_can_train() to authenticated;
grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.save_workout_session(jsonb) to authenticated;
grant execute on function public.get_workout_session(uuid) to authenticated;
grant execute on function public.list_workout_sessions(date, date, integer) to authenticated;
grant execute on function public.get_previous_exercise_sets(uuid[], date, uuid) to authenticated;
grant execute on function public.get_exercise_progress(uuid, date, date) to authenticated;
