-- Grupo muscular obligatorio (paso 1 de 2: compatible con datos anteriores).
-- Exige un grupo del catálogo al crear un ejercicio y al editar su nombre, notas o
-- grupo. Los ejercicios antiguos sin grupo («Sin clasificar») conservan su
-- historial, se pueden leer, usar en sesiones y archivar, pero para editarlos hay
-- que asignarles un grupo. La validez del id la garantiza la clave foránea.

create or replace function private.require_muscle_group()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.muscle_group_id is null
     and (
       tg_op = 'INSERT'
       or new.name is distinct from old.name
       or new.notes is distinct from old.notes
       or old.muscle_group_id is not null
     )
  then
    raise exception 'Selecciona un grupo muscular'
      using errcode = '23514', hint = 'muscle_group_required';
  end if;
  return new;
end;
$$;

revoke execute on function private.require_muscle_group() from public, anon, authenticated;

create trigger exercises_require_muscle_group
before insert or update on public.exercises
for each row execute function private.require_muscle_group();
