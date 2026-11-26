-- Datos con grupos musculares en texto libre, como existían antes del catálogo.
insert into auth.users (id, email, raw_app_meta_data) values
  ('f0000000-0000-0000-0000-00000000000f', 'legado@example.com', '{"provisioned":"true"}');

insert into public.exercises (id, user_id, name, muscle_group, notes) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000f', 'Press de banca', 'PECHO ', null),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000f', 'Aperturas', '  pecho', null),
  ('f1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000f', 'Curl femoral', 'Femorales', null),
  ('f1000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000f', 'Hip thrust', 'glúteo', null),
  ('f1000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-00000000000f', 'Plancha', 'Abdominales', null),
  ('f1000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-00000000000f', 'Remo', 'Espalda', null),
  ('f1000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-00000000000f', 'Elevación', 'Hombro', null),
  ('f1000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-00000000000f', 'Prensa', 'Piernas', 'Asiento 4'),
  ('f1000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-00000000000f', 'Burpees', null, null),
  ('f1000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-00000000000f', 'Extensión lumbar', 'Lumbar', null);
