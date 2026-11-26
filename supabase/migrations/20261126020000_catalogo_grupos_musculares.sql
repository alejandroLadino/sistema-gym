-- Catálogo predefinido de grupos musculares (paso 1 de 2: ampliar).
-- Los ejercicios pasan de guardar texto libre ("Pecho", "PECHO ") a referenciar
-- el catálogo. La columna de texto se elimina en la migración siguiente, después
-- de desplegar la app que ya usa muscle_group_id.

create table public.muscle_groups (
  id text primary key check (id ~ '^[a-z_]{1,40}$'),
  name text not null unique check (char_length(name) between 1 and 60),
  region text not null check (region in ('Tren superior', 'Tronco', 'Tren inferior', 'General')),
  sort_order smallint not null
);

insert into public.muscle_groups (id, name, region, sort_order) values
  ('pecho',           'Pecho',           'Tren superior', 10),
  ('espalda',         'Espalda',         'Tren superior', 20),
  ('hombros',         'Hombros',         'Tren superior', 30),
  ('trapecio',        'Trapecio',        'Tren superior', 40),
  ('biceps',          'Bíceps',          'Tren superior', 50),
  ('triceps',         'Tríceps',         'Tren superior', 60),
  ('antebrazos',      'Antebrazos',      'Tren superior', 70),
  ('abdomen',         'Abdomen',         'Tronco',        80),
  ('lumbares',        'Lumbares',        'Tronco',        90),
  ('gluteos',         'Glúteos',         'Tren inferior', 100),
  ('cuadriceps',      'Cuádriceps',      'Tren inferior', 110),
  ('isquiotibiales',  'Isquiotibiales',  'Tren inferior', 120),
  ('aductores',       'Aductores',       'Tren inferior', 130),
  ('abductores',      'Abductores',      'Tren inferior', 140),
  ('pantorrillas',    'Pantorrillas',    'Tren inferior', 150),
  ('cuerpo_completo', 'Cuerpo completo', 'General',       160),
  ('cardio',          'Cardio',          'General',       170);

-- Catálogo de solo lectura para usuarios autenticados; se modifica con migraciones.
alter table public.muscle_groups enable row level security;

create policy "catálogo: lectura" on public.muscle_groups
for select to authenticated using (true);

revoke all on table public.muscle_groups from anon, authenticated;
grant select on table public.muscle_groups to authenticated;

-- Referencia desde los ejercicios.
alter table public.exercises
  add column muscle_group_id text references public.muscle_groups (id) on update cascade on delete restrict;

create index exercises_muscle_group_idx on public.exercises (muscle_group_id);

-- Convierte un texto libre ("PECHO ", "Femorales", "glúteo") al id del catálogo.
-- Devuelve null si no hay coincidencia.
create or replace function private.muscle_group_from_text(p_text text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v text;
  v_id text;
begin
  if p_text is null then
    return null;
  end if;

  v := lower(translate(btrim(p_text), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
  v := regexp_replace(v, '\s+', ' ', 'g');
  if v = '' then
    return null;
  end if;

  v := case v
    when 'pectoral' then 'pecho'
    when 'pectorales' then 'pecho'
    when 'dorsal' then 'espalda'
    when 'dorsales' then 'espalda'
    when 'espalda alta' then 'espalda'
    when 'deltoide' then 'hombros'
    when 'deltoides' then 'hombros'
    when 'trapecios' then 'trapecio'
    when 'abdominal' then 'abdomen'
    when 'abdominales' then 'abdomen'
    when 'abs' then 'abdomen'
    when 'core' then 'abdomen'
    when 'espalda baja' then 'lumbares'
    when 'quads' then 'cuadriceps'
    when 'isquios' then 'isquiotibiales'
    when 'femoral' then 'isquiotibiales'
    when 'femorales' then 'isquiotibiales'
    when 'gemelo' then 'pantorrillas'
    when 'gemelos' then 'pantorrillas'
    when 'full body' then 'cuerpo completo'
    else v
  end;
  v := replace(v, ' ', '_');

  -- Coincidencia exacta o singular → plural ("hombro" → "hombros", "lumbar" → "lumbares").
  select mg.id into v_id
  from public.muscle_groups mg
  where mg.id in (v, v || 's', v || 'es')
  order by length(mg.id)
  limit 1;

  return v_id;
end;
$$;

revoke execute on function private.muscle_group_from_text(text) from public, anon, authenticated;

-- Rellena los ejercicios existentes. Lo que no coincide se conserva en las notas.
update public.exercises
set muscle_group_id = private.muscle_group_from_text(muscle_group)
where muscle_group is not null and muscle_group_id is null;

update public.exercises
set notes = left(concat_ws(E'\n', 'Grupo muscular anterior: ' || btrim(muscle_group), notes), 1000)
where muscle_group is not null and btrim(muscle_group) <> '' and muscle_group_id is null
  and strpos(coalesce(notes, ''), 'Grupo muscular anterior: ' || btrim(muscle_group)) = 0;

-- El detalle de la sesión devuelve el nombre del grupo desde el catálogo.
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

revoke execute on function public.get_workout_session(uuid) from public, anon;
grant execute on function public.get_workout_session(uuid) to authenticated;
