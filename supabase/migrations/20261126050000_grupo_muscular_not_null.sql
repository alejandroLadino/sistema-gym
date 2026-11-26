-- Grupo muscular obligatorio (paso 2 de 2: restricción definitiva).
-- Aplicar cuando no queden ejercicios «Sin clasificar». Si queda alguno, la
-- migración se detiene sin cambiar nada: clasifícalos desde la pantalla
-- Ejercicios (filtro «Sin clasificar») y vuelve a aplicarla.

do $$
declare
  v_pendientes integer;
begin
  select count(*) into v_pendientes from public.exercises where muscle_group_id is null;
  if v_pendientes > 0 then
    raise exception 'Hay % ejercicio(s) sin grupo muscular. Clasifícalos antes de aplicar esta migración.', v_pendientes;
  end if;
end;
$$;

alter table public.exercises alter column muscle_group_id set not null;
