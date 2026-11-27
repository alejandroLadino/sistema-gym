-- Equipo del ejercicio (Mancuernas, Barra, Máquina Smith, Máquina, Polea, Banda
-- elástica, Peso corporal u Otro), separado del nombre.
--
-- * exercises.equipment: opcional. Los ejercicios existentes conservan su nombre, su ID
--   y su historial; el equipo se puede asignar al editarlos.
-- * El mismo nombre puede repetirse con equipos distintos (cada variante es un ejercicio
--   con su propio ID e historial). No se repite la combinación nombre + equipo entre los
--   ejercicios activos de una persona («sin indicar» cuenta como un valor más).
--
-- Compatible con la app anterior: columna nueva nula; la regla anterior (nombre único)
-- se relaja, así que todo lo que la app anterior podía guardar sigue siendo válido.

alter table public.exercises
  add column equipment text
    check (equipment is null or equipment in
      ('mancuernas', 'barra', 'smith', 'maquina', 'polea', 'banda', 'corporal', 'otro'));

create unique index exercises_user_active_name_equipment_key
on public.exercises (user_id, lower(btrim(name)), coalesce(equipment, ''))
where archived_at is null;

drop index public.exercises_user_active_name_key;
