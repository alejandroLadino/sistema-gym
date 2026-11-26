-- Una sesión creada antes de que existiera el estado «finalizada».
insert into auth.users (id, email, raw_app_meta_data) values
  ('f3000000-0000-0000-0000-00000000000f', 'historica@example.com', '{"provisioned":"true"}');
update public.profiles set must_change_password = false where id = 'f3000000-0000-0000-0000-00000000000f';
insert into public.exercises (id, user_id, name, muscle_group_id) values
  ('f3100000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-00000000000f', 'Press', 'pecho');
insert into public.workout_sessions (id, user_id, session_date) values
  ('f3200000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-00000000000f', '2026-11-01');
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values
  ('f3300000-0000-0000-0000-000000000001', 'f3200000-0000-0000-0000-000000000001',
   'f3000000-0000-0000-0000-00000000000f', 'f3100000-0000-0000-0000-000000000001', 0);
insert into public.exercise_sets (session_exercise_id, user_id, position, reps, weight_kg) values
  ('f3300000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-00000000000f', 0, 10, 40);
