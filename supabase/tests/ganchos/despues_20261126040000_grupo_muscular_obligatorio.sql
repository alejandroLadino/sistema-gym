-- Paso 1: el ejercicio sin clasificar sigue visible y usable; altas y ediciones exigen grupo.
select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-00000000000f","role":"authenticated"}', false);
set role authenticated;
do $$
declare ok boolean;
begin
  assert (select count(*) from public.exercises where muscle_group_id is null) = 1, 'El ejercicio sin clasificar sigue visible';
  assert (public.get_workout_session('f2200000-0000-0000-0000-000000000001') -> 'exercises' -> 0 ->> 'name') = 'Remo antiguo',
    'La sesión anterior sigue mostrando su ejercicio';

  -- Alta sin grupo: rechazada.
  ok := false;
  begin
    insert into public.exercises (name) values ('Sin grupo');
  exception when check_violation then ok := true;
  end;
  assert ok, 'Crear un ejercicio sin grupo debe fallar';

  -- Editar el nombre sin asignar grupo: rechazado.
  ok := false;
  begin
    update public.exercises set name = 'Remo renombrado' where id = 'f2100000-0000-0000-0000-000000000001';
  exception when check_violation then ok := true;
  end;
  assert ok, 'Editar un ejercicio sin clasificar exige grupo';

  -- Archivar sí se permite sin clasificar.
  update public.exercises set archived_at = now() where id = 'f2100000-0000-0000-0000-000000000001';
  assert (select archived_at is not null from public.exercises where id = 'f2100000-0000-0000-0000-000000000001'),
    'Archivar un ejercicio sin clasificar debe funcionar';

  -- Clasificarlo (y reactivarlo) funciona.
  update public.exercises set muscle_group_id = 'espalda', archived_at = null where id = 'f2100000-0000-0000-0000-000000000001';

  -- Quitar el grupo a un ejercicio clasificado: rechazado.
  ok := false;
  begin
    update public.exercises set muscle_group_id = null where id = 'f2100000-0000-0000-0000-000000000001';
  exception when check_violation then ok := true;
  end;
  assert ok, 'No se puede quitar el grupo';
end $$;
reset role;
select set_config('request.jwt.claims', '', false);
\echo '   Grupo obligatorio (paso 1) con ejercicios sin clasificar: OK'
