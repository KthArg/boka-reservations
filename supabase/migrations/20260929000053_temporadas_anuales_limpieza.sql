-- Migración …053 — Temporadas de precio que se repiten cada año, paso 2 (spec 0040).
--
-- Borra las fechas con año de tour_pricing, que el código dejó de usar en …052: valid_from,
-- valid_until y sus CHECK (valid_season_range, season_label_required_with_dates). El nombre de la
-- temporada lo exige tour_pricing_season_shape.
--
-- Se aplica después de desplegar el código de …052 y de verificar que esta consulta da 0 filas:
--   SELECT id FROM public.tour_pricing
--   WHERE valid_from IS NOT NULL
--     AND (season_start IS NULL
--          OR (season_start <> to_char(valid_from, 'MM-DD') AND season_start <> '01-01'));
--
-- Reversión: no se recuperan las fechas con año (por diseño). Para volver al modelo anterior hay
-- que restaurar el respaldo previo a …052.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.tour_pricing
  DROP CONSTRAINT IF EXISTS valid_season_range,
  DROP CONSTRAINT IF EXISTS season_label_required_with_dates,
  DROP COLUMN valid_from,
  DROP COLUMN valid_until;
