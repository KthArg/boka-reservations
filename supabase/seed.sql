-- Seed de desarrollo — nunca ejecutar en producción directamente.
-- Se aplica automáticamente con: supabase db reset

-- Usuarios internos (IDs fijos para facilitar pruebas; en Etapa 4 se crean los auth.users correspondientes)
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

-- Precios Cerro Chompipe
INSERT INTO tour_pricing (tour_id, ticket_type, price_usd, season_label, valid_from, valid_until, active) VALUES
  ('11111111-0000-0000-0000-000000000001', 'adult',   65.00, 'alta', '2025-12-01', '2026-04-30', true),
  ('11111111-0000-0000-0000-000000000001', 'child',   40.00, 'alta', '2025-12-01', '2026-04-30', true),
  ('11111111-0000-0000-0000-000000000001', 'student', 50.00, 'alta', '2025-12-01', '2026-04-30', true),
  ('11111111-0000-0000-0000-000000000001', 'adult',   55.00, 'baja', '2026-05-01', '2026-11-30', true),
  ('11111111-0000-0000-0000-000000000001', 'child',   35.00, 'baja', '2026-05-01', '2026-11-30', true),
  ('11111111-0000-0000-0000-000000000001', 'student', 42.00, 'baja', '2026-05-01', '2026-11-30', true);

-- Precios Birdwatching La Selva
INSERT INTO tour_pricing (tour_id, ticket_type, price_usd, season_label, valid_from, valid_until, active) VALUES
  ('11111111-0000-0000-0000-000000000002', 'adult', 80.00, 'alta', '2025-12-01', '2026-04-30', true),
  ('11111111-0000-0000-0000-000000000002', 'child', 50.00, 'alta', '2025-12-01', '2026-04-30', true),
  ('11111111-0000-0000-0000-000000000002', 'adult', 70.00, 'baja', '2026-05-01', '2026-11-30', true),
  ('11111111-0000-0000-0000-000000000002', 'child', 45.00, 'baja', '2026-05-01', '2026-11-30', true);

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
