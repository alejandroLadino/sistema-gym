-- Catálogo de grupos musculares (paso 2 de 2: contraer).
-- Aplicar DESPUÉS de desplegar la versión de la app que usa muscle_group_id.
-- Vuelve a convertir lo que se haya guardado como texto entre ambos pasos y
-- elimina la columna de texto libre.

update public.exercises
set muscle_group_id = private.muscle_group_from_text(muscle_group)
where muscle_group is not null and muscle_group_id is null;

update public.exercises
set notes = left(concat_ws(E'\n', 'Grupo muscular anterior: ' || btrim(muscle_group), notes), 1000)
where muscle_group is not null and btrim(muscle_group) <> '' and muscle_group_id is null
  and strpos(coalesce(notes, ''), 'Grupo muscular anterior: ' || btrim(muscle_group)) = 0;

alter table public.exercises drop column muscle_group;
