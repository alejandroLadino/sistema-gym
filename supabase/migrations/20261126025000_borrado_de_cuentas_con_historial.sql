-- Corrige el borrado de una cuenta con entrenamientos (p. ej., desde el panel de
-- Supabase → Authentication → Users). La clave session_exercises → exercises es
-- ON DELETE RESTRICT (no se borra un ejercicio con historial: se archiva). En la
-- cascada auth.users → profiles → exercises, esa restricción saltaba antes de que
-- la otra rama (workout_sessions → session_exercises) borrara las referencias.
-- Al borrar un perfil, este trigger elimina primero sus sesiones.

create or replace function private.delete_profile_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.workout_sessions where user_id = old.id;
  return old;
end;
$$;

revoke execute on function private.delete_profile_sessions() from public, anon, authenticated;

create trigger profiles_delete_sessions_first
before delete on public.profiles
for each row execute function private.delete_profile_sessions();
