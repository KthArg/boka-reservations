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

-- Tours
INSERT INTO tours (id, slug, name_es, name_en, description_es, description_en,
  difficulty, duration_minutes, meeting_point_es, meeting_point_en,
  includes_es, includes_en, min_participants, max_capacity, status)
VALUES
  ('11111111-0000-0000-0000-000000000001',
   'cerro-chompipe',
   'Senderismo Cerro Chompipe',
   'Cerro Chompipe Hiking',
   'Un ascenso moderado con vistas panorámicas del Valle Central. Ideal para observar aves de montaña y disfrutar del bosque nuboso.',
   'A moderate ascent with panoramic views of the Central Valley. Ideal for observing mountain birds and enjoying cloud forest.',
   'moderate', 240,
   'Parqueo de la Iglesia de Zetillal, Goicoechea',
   'Zetillal Church Parking, Goicoechea',
   'Guía certificado, agua, snack energético, botiquín de primeros auxilios',
   'Certified guide, water, energy snack, first aid kit',
   2, 12, 'active'),

  ('11111111-0000-0000-0000-000000000002',
   'birdwatching-la-selva',
   'Birdwatching La Selva',
   'Birdwatching La Selva',
   'Recorrido por los senderos de La Selva con guía ornitólogo. Posibilidad de avistar más de 50 especies en una mañana.',
   'Trail tour through La Selva with an ornithologist guide. Opportunity to spot over 50 species in one morning.',
   'easy', 180,
   'Portón principal de La Selva Biological Station, Puerto Viejo de Sarapiquí',
   'Main gate of La Selva Biological Station, Puerto Viejo de Sarapiquí',
   'Guía ornitólogo, binoculares si no los tenés, lista de aves, entrada a La Selva',
   'Ornithologist guide, binoculars if needed, bird checklist, La Selva entrance fee',
   1, 8, 'active');

-- Información que los términos prometen publicar de cada tour (spec 0034): sin ella el tour no se
-- puede reservar.
UPDATE tours SET
  excludes_es = 'Transporte hasta el punto de encuentro, almuerzo',
  excludes_en = 'Transport to the meeting point, lunch',
  requirements_es = 'Mayores de 8 años, condición física moderada, zapatos de montaña',
  requirements_en = 'Ages 8 and up, moderate fitness, hiking shoes',
  child_age_min = 8,
  child_age_max = 12
WHERE id = '11111111-0000-0000-0000-000000000001';

UPDATE tours SET
  excludes_es = 'Transporte hasta el punto de encuentro, alimentación',
  excludes_en = 'Transport to the meeting point, meals',
  requirements_es = 'Sin requisito de edad; caminata suave por senderos planos',
  requirements_en = 'No age requirement; easy walk on flat trails',
  child_age_min = 3,
  child_age_max = 12
WHERE id = '11111111-0000-0000-0000-000000000002';

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

-- Precios Cerro Chompipe
INSERT INTO tour_pricing (tour_id, ticket_type, price_usd, season_label, season_start, season_end, active) VALUES
  ('11111111-0000-0000-0000-000000000001', 'adult',   65.00, 'alta', '12-01', '04-30', true),
  ('11111111-0000-0000-0000-000000000001', 'child',   40.00, 'alta', '12-01', '04-30', true),
  ('11111111-0000-0000-0000-000000000001', 'student', 50.00, 'alta', '12-01', '04-30', true),
  ('11111111-0000-0000-0000-000000000001', 'adult',   55.00, 'baja', '05-01', '11-30', true),
  ('11111111-0000-0000-0000-000000000001', 'child',   35.00, 'baja', '05-01', '11-30', true),
  ('11111111-0000-0000-0000-000000000001', 'student', 42.00, 'baja', '05-01', '11-30', true);

-- Precios Birdwatching La Selva
INSERT INTO tour_pricing (tour_id, ticket_type, price_usd, season_label, season_start, season_end, active) VALUES
  ('11111111-0000-0000-0000-000000000002', 'adult', 80.00, 'alta', '12-01', '04-30', true),
  ('11111111-0000-0000-0000-000000000002', 'child', 50.00, 'alta', '12-01', '04-30', true),
  ('11111111-0000-0000-0000-000000000002', 'adult', 70.00, 'baja', '05-01', '11-30', true),
  ('11111111-0000-0000-0000-000000000002', 'child', 45.00, 'baja', '05-01', '11-30', true);

-- Schedules Cerro Chompipe: sábados y domingos a las 6am
INSERT INTO tour_schedules (tour_id, day_of_week, start_time, capacity, active) VALUES
  ('11111111-0000-0000-0000-000000000001', 6, '06:00', 12, true),
  ('11111111-0000-0000-0000-000000000001', 0, '06:00', 12, true);

-- Schedules Birdwatching La Selva: martes, jueves y sábados — dos salidas por día
INSERT INTO tour_schedules (tour_id, day_of_week, start_time, capacity, active) VALUES
  ('11111111-0000-0000-0000-000000000002', 2, '05:30', 8, true),
  ('11111111-0000-0000-0000-000000000002', 2, '10:00', 8, true),
  ('11111111-0000-0000-0000-000000000002', 4, '05:30', 8, true),
  ('11111111-0000-0000-0000-000000000002', 4, '10:00', 8, true),
  ('11111111-0000-0000-0000-000000000002', 6, '05:30', 8, true),
  ('11111111-0000-0000-0000-000000000002', 6, '10:00', 8, true);
