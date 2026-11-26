-- Las sesiones anteriores quedan finalizadas (históricas), con su historial, y se pueden corregir.
select set_config('request.jwt.claims', '{"sub":"f3000000-0000-0000-0000-00000000000f","role":"authenticated"}', false);
set role authenticated;
do $$
declare v_before timestamptz;
begin
  select finished_at into v_before from public.workout_sessions where id = 'f3200000-0000-0000-0000-000000000001';
  assert v_before is not null, 'Una sesión anterior a la migración queda finalizada';
  -- Corregirla conserva su estado.
  perform public.save_workout_session('{"id": "f3200000-0000-0000-0000-000000000001", "session_date": "2026-11-01",
    "exercises": [{"exercise_id": "f3100000-0000-0000-0000-000000000001", "sets": [{"reps": 12, "weight_kg": 40}]}]}'::jsonb);
  assert (select finished_at = v_before from public.workout_sessions where id = 'f3200000-0000-0000-0000-000000000001'),
    'Corregir una sesión histórica no cambia su estado';
  assert (public.get_workout_session('f3200000-0000-0000-0000-000000000001') -> 'exercises' -> 0 -> 'sets' -> 0 ->> 'reps')::int = 12,
    'La corrección se guarda';
end $$;
reset role;
select set_config('request.jwt.claims', '', false);
delete from auth.users where id = 'f3000000-0000-0000-0000-00000000000f';
\echo '   Estado de sesión: las anteriores quedan finalizadas y se pueden corregir: OK'
