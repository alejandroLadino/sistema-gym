-- Paso 2: columna NOT NULL; el historial del ejercicio clasificado sigue intacto.
do $$
begin
  assert (select is_nullable = 'NO' from information_schema.columns
          where table_schema = 'public' and table_name = 'exercises' and column_name = 'muscle_group_id'),
    'muscle_group_id debe ser NOT NULL';
  assert (select count(*) from public.exercise_sets where user_id = 'f2000000-0000-0000-0000-00000000000f') = 1,
    'El historial se conserva';
end $$;
delete from auth.users where id = 'f2000000-0000-0000-0000-00000000000f';
\echo '   Grupo obligatorio (paso 2, NOT NULL): OK'
