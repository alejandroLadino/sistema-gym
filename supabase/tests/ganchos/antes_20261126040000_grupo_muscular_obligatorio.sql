-- Un ejercicio antiguo sin grupo («Sin clasificar») con una sesión en su historial.
insert into auth.users (id, email, raw_app_meta_data) values
  ('f2000000-0000-0000-0000-00000000000f', 'sinclasificar@example.com', '{"provisioned":"true"}');
update public.profiles set must_change_password = false where id = 'f2000000-0000-0000-0000-00000000000f';

insert into public.exercises (id, user_id, name) values
  ('f2100000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000f', 'Remo antiguo');
insert into public.workout_sessions (id, user_id, session_date) values
  ('f2200000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000f', '2026-11-01');
insert into public.session_exercises (id, session_id, user_id, exercise_id, position) values
  ('f2300000-0000-0000-0000-000000000001', 'f2200000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000f',
   'f2100000-0000-0000-0000-000000000001', 0);
insert into public.exercise_sets (session_exercise_id, user_id, position, reps, weight_kg) values
  ('f2300000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000f', 0, 10, 30);
