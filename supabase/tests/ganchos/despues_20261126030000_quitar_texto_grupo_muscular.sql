-- Verifica la conversión de texto libre al catálogo y limpia los datos sembrados.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('f1000000-0000-0000-0000-000000000001'::uuid, 'pecho'),
      ('f1000000-0000-0000-0000-000000000002'::uuid, 'pecho'),
      ('f1000000-0000-0000-0000-000000000003'::uuid, 'isquiotibiales'),
      ('f1000000-0000-0000-0000-000000000004'::uuid, 'gluteos'),
      ('f1000000-0000-0000-0000-000000000005'::uuid, 'abdomen'),
      ('f1000000-0000-0000-0000-000000000006'::uuid, 'espalda'),
      ('f1000000-0000-0000-0000-000000000007'::uuid, 'hombros'),
      ('f1000000-0000-0000-0000-000000000010'::uuid, 'lumbares'),
      ('f1000000-0000-0000-0000-000000000011'::uuid, 'triceps')
    ) as t(id, esperado)
  loop
    assert (select muscle_group_id from public.exercises where id = r.id) = r.esperado,
      format('Conversión incorrecta para %s: se esperaba %s', r.id, r.esperado);
  end loop;

  -- Sin coincidencia: queda sin grupo y el texto original se conserva en las notas (una sola vez).
  assert (select muscle_group_id is null and notes = E'Grupo muscular anterior: Piernas\nAsiento 4'
          from public.exercises where id = 'f1000000-0000-0000-0000-000000000008'),
    format('Texto sin coincidencia mal conservado: %s',
           (select notes from public.exercises where id = 'f1000000-0000-0000-0000-000000000008'));
  assert (select muscle_group_id is null and notes is null from public.exercises where id = 'f1000000-0000-0000-0000-000000000009'),
    'Sin grupo debe seguir sin grupo';

  assert not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'exercises' and column_name = 'muscle_group'),
    'La columna de texto muscle_group debe eliminarse';
end $$;

delete from auth.users where id = 'f0000000-0000-0000-0000-00000000000f';
\echo '   Conversión de grupos musculares en texto al catálogo: OK'
