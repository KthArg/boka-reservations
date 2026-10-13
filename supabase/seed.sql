-- Seed de desarrollo — nunca ejecutar en producción directamente.
-- Se aplica automáticamente con: supabase db reset

-- Usuarios en auth.users (necesarios para login con Supabase Auth)
-- Contraseñas: admin1234 | guide1234 | staff1234
-- Los campos *_token y email_change deben ser '' (no NULL); GoTrue los escanea como string no-pointer.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token,
  email_change_token_new, email_change, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
) VALUES
  ('00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@bokatrails.com',
   crypt('admin1234', gen_salt('bf')),
   now(), now(), now(), '{}', '{}',
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'carlos@bokatrails.com',
   crypt('guide1234', gen_salt('bf')),
   now(), now(), now(), '{}', '{}',
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'staff@bokatrails.com',
   crypt('staff1234', gen_salt('bf')),
   now(), now(), now(), '{}', '{}',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Usuarios internos (IDs fijos que coinciden con auth.users de arriba)
INSERT INTO users (id, email, role, full_name, active) VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin@bokatrails.com',  'admin', 'Admin BokaTrails', true),
  ('00000000-0000-0000-0000-000000000003', 'staff@bokatrails.com',  'staff', 'Ana Mora',         true);

INSERT INTO users (id, email, role, full_name, phone, active) VALUES
  ('00000000-0000-0000-0000-000000000002', 'carlos@bokatrails.com', 'guide', 'Carlos Ríos', '+506 8888-1111', true);

-- Tours: los dos fijos ya existen (migración …061, spec 0047). Acá solo se completan para
-- desarrollo local, con la información que los términos prometen publicar (spec 0034): sin ella
-- el tour no se puede reservar.
UPDATE tours SET
  name_es = 'Caminata diurna',
  name_en = 'Daytime walk',
  description_es = 'Un recorrido de día por los senderos del bosque, con vistas del valle y aves de montaña.',
  description_en = 'A daytime walk along the forest trails, with valley views and mountain birds.',
  difficulty = 'moderate',
  duration_minutes = 240,
  meeting_point_es = 'Parqueo de la Iglesia de Zetillal, Goicoechea',
  meeting_point_en = 'Zetillal Church Parking, Goicoechea',
  includes_es = 'Guía certificado, agua, snack energético, botiquín de primeros auxilios',
  includes_en = 'Certified guide, water, energy snack, first aid kit',
  excludes_es = 'Transporte hasta el punto de encuentro, almuerzo',
  excludes_en = 'Transport to the meeting point, lunch',
  requirements_es = 'Mayores de 8 años, condición física moderada, zapatos de montaña',
  requirements_en = 'Ages 8 and up, moderate fitness, hiking shoes',
  child_age_min = 8,
  child_age_max = 12,
  min_participants = 2,
  max_capacity = 12
WHERE kind = 'day';

UPDATE tours SET
  name_es = 'Caminata nocturna',
  name_en = 'Night walk',
  description_es = 'El bosque de noche con guía naturalista: ranas, insectos y mamíferos nocturnos.',
  description_en = 'The forest at night with a naturalist guide: frogs, insects and nocturnal mammals.',
  difficulty = 'easy',
  duration_minutes = 120,
  meeting_point_es = 'Parqueo de la Iglesia de Zetillal, Goicoechea',
  meeting_point_en = 'Zetillal Church Parking, Goicoechea',
  includes_es = 'Guía naturalista, foco, botiquín de primeros auxilios',
  includes_en = 'Naturalist guide, flashlight, first aid kit',
  excludes_es = 'Transporte hasta el punto de encuentro, alimentación',
  excludes_en = 'Transport to the meeting point, meals',
  requirements_es = 'Zapatos cerrados y abrigo liviano',
  requirements_en = 'Closed shoes and a light jacket',
  child_age_min = 3,
  child_age_max = 12,
  min_participants = 1,
  max_capacity = 8
WHERE kind = 'night';

-- Identidad del operador SOLO PARA DESARROLLO LOCAL (spec 0034). Producción la carga el admin
-- desde el panel; sin ella la venta en línea queda cerrada.
UPDATE business_settings SET
  operator_legal_name = 'Boka Verde Datos de Prueba S.A.',
  operator_tax_id = '3-101-000000',
  operator_address = 'San José, Costa Rica (dirección de prueba)',
  operator_brand = 'Boka Verde',
  operator_contact_email = 'consultas@example.com',
  operator_privacy_email = 'privacidad@example.com',
  operator_phone = '+506 2000-0000',
  operator_hours = 'de lunes a viernes, de 8:00 a. m. a 5:00 p. m.'
WHERE id = 1;

-- Precios del diurno
INSERT INTO tour_pricing (tour_id, ticket_type, price_usd, season_label, season_start, season_end, active) VALUES
  ((SELECT id FROM tours WHERE kind = 'day'), 'adult',   65.00, 'alta', '12-01', '04-30', true),
  ((SELECT id FROM tours WHERE kind = 'day'), 'child',   40.00, 'alta', '12-01', '04-30', true),
  ((SELECT id FROM tours WHERE kind = 'day'), 'student', 50.00, 'alta', '12-01', '04-30', true),
  ((SELECT id FROM tours WHERE kind = 'day'), 'adult',   55.00, 'baja', '05-01', '11-30', true),
  ((SELECT id FROM tours WHERE kind = 'day'), 'child',   35.00, 'baja', '05-01', '11-30', true),
  ((SELECT id FROM tours WHERE kind = 'day'), 'student', 42.00, 'baja', '05-01', '11-30', true);

-- Precios del nocturno
INSERT INTO tour_pricing (tour_id, ticket_type, price_usd, season_label, season_start, season_end, active) VALUES
  ((SELECT id FROM tours WHERE kind = 'night'), 'adult', 80.00, 'alta', '12-01', '04-30', true),
  ((SELECT id FROM tours WHERE kind = 'night'), 'child', 50.00, 'alta', '12-01', '04-30', true),
  ((SELECT id FROM tours WHERE kind = 'night'), 'adult', 70.00, 'baja', '05-01', '11-30', true),
  ((SELECT id FROM tours WHERE kind = 'night'), 'child', 45.00, 'baja', '05-01', '11-30', true);

-- Horarios del diurno: sábados y domingos a las 6:00
INSERT INTO tour_schedules (tour_id, day_of_week, start_time, capacity, active) VALUES
  ((SELECT id FROM tours WHERE kind = 'day'), 6, '06:00', 12, true),
  ((SELECT id FROM tours WHERE kind = 'day'), 0, '06:00', 12, true);

-- Horarios del nocturno: martes, jueves y sábados, dos salidas por noche
INSERT INTO tour_schedules (tour_id, day_of_week, start_time, capacity, active) VALUES
  ((SELECT id FROM tours WHERE kind = 'night'), 2, '17:30', 8, true),
  ((SELECT id FROM tours WHERE kind = 'night'), 2, '19:30', 8, true),
  ((SELECT id FROM tours WHERE kind = 'night'), 4, '17:30', 8, true),
  ((SELECT id FROM tours WHERE kind = 'night'), 4, '19:30', 8, true),
  ((SELECT id FROM tours WHERE kind = 'night'), 6, '17:30', 8, true),
  ((SELECT id FROM tours WHERE kind = 'night'), 6, '19:30', 8, true);
