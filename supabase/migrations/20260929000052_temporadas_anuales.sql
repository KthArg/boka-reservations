-- Migración …052 — Temporadas de precio que se repiten cada año, paso 1 (spec 0040).
--
--   1. tour_pricing gana season_start y season_end ('MM-DD', sin año): las dos nulas para el
--      precio base o las dos con valor para una temporada, que puede cruzar el fin de año.
--   2. Conversión de las temporadas con año (§5.5): vencidas → inactivas; de un año o más → todo
--      el año; el resto → MM-DD de sus fechas; si tras la conversión dos chocan, queda activa la
--      vigente hoy o la que empieza antes, y las demás pasan a inactivas.
--   3. Fuera el EXCLUDE con daterange (no sirve para rangos que se repiten) y el índice del precio
--      base, que pasa a mirar season_start.
--   4. Constraint trigger diferido tour_pricing_season_overlap: al confirmar, rechaza dos
--      temporadas activas del mismo tour y tiquete que compartan un día del año (SQLSTATE 23P01).
--      Diferido, para que un guardado que corre el borde entre dos temporadas se evalúe sobre el
--      estado final.
--
-- valid_from, valid_until y sus CHECK quedan hasta …053 (paso 2): así el código anterior sigue
-- leyendo precios durante el despliegue.
--
-- Hardening: SECURITY DEFINER + search_path = '' en la función del trigger (no depende de la RLS
-- de lectura de quien guarda); REVOKE de PUBLIC, anon, authenticated en las funciones nuevas.
--
-- Despliegue: no editar precios entre esta migración y el despliegue del código nuevo (el código
-- anterior escribe valid_* y no season_*). Verificación después del despliegue (debe dar 0 filas):
--   SELECT id FROM public.tour_pricing
--   WHERE valid_from IS NOT NULL
--     AND (season_start IS NULL
--          OR (season_start <> to_char(valid_from, 'MM-DD') AND season_start <> '01-01'));
--
-- Reversión (antes de …053):
--   1. Si el código nuevo ya escribió: desactivar o convertir a mano las filas con
--      season_start IS NOT NULL AND valid_from IS NULL, y poner valid_from/valid_until en NULL en
--      las filas con season_start IS NULL (si no, al quitar season_* cambian de tipo).
--   2. DROP TRIGGER tour_pricing_season_overlap ON public.tour_pricing; DROP FUNCTION de las tres
--      funciones; DROP de los CHECK tour_pricing_season_shape y tour_pricing_season_days.
--   3. Recrear el índice tour_pricing_one_base_per_type y el EXCLUDE
--      tour_pricing_no_seasonal_overlap como en …041 (con extensions en el search_path, por
--      btree_gist); DROP de las columnas season_*.
--   4. Reactivar a mano las filas que la conversión dejó inactivas (quedan en los NOTICE).

SET LOCAL lock_timeout = '5s';

-- ================================================================
-- 1. Columnas
-- ================================================================

ALTER TABLE public.tour_pricing
  ADD COLUMN season_start text,
  ADD COLUMN season_end   text;

-- ================================================================
-- 2. Funciones de apoyo (día del año en un año bisiesto de referencia y superposición)
-- ================================================================

CREATE FUNCTION public.tour_pricing_day_of_year(p_md text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXTRACT(doy FROM to_date('2000-' || p_md, 'YYYY-MM-DD'))::integer;
$$;
REVOKE EXECUTE ON FUNCTION public.tour_pricing_day_of_year(text) FROM PUBLIC, anon, authenticated;

-- Dos temporadas día-mes comparten al menos un día. Una que cruza el año se parte en dos.
CREATE FUNCTION public.tour_pricing_seasons_overlap(
  p_a_start text, p_a_end text, p_b_start text, p_b_end text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_last  constant integer := 366;
  a_from  integer[];
  a_to    integer[];
  b_from  integer[];
  b_to    integer[];
  i       integer;
  j       integer;
BEGIN
  IF p_a_start <= p_a_end THEN
    a_from := ARRAY[public.tour_pricing_day_of_year(p_a_start)];
    a_to   := ARRAY[public.tour_pricing_day_of_year(p_a_end)];
  ELSE
    a_from := ARRAY[public.tour_pricing_day_of_year(p_a_start), 1];
    a_to   := ARRAY[v_last, public.tour_pricing_day_of_year(p_a_end)];
  END IF;
  IF p_b_start <= p_b_end THEN
    b_from := ARRAY[public.tour_pricing_day_of_year(p_b_start)];
    b_to   := ARRAY[public.tour_pricing_day_of_year(p_b_end)];
  ELSE
    b_from := ARRAY[public.tour_pricing_day_of_year(p_b_start), 1];
    b_to   := ARRAY[v_last, public.tour_pricing_day_of_year(p_b_end)];
  END IF;

  FOR i IN 1 .. array_length(a_from, 1) LOOP
    FOR j IN 1 .. array_length(b_from, 1) LOOP
      IF a_from[i] <= b_to[j] AND b_from[j] <= a_to[i] THEN
        RETURN true;
      END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tour_pricing_seasons_overlap(text, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- ================================================================
-- 3. Conversión de las temporadas con año (spec 0040 §5.5)
-- ================================================================

-- Todas las filas con fechas pasan a día-mes (también las inactivas: sin season_* se verían
-- como precio base en el editor).
UPDATE public.tour_pricing
   SET season_start = to_char(valid_from, 'MM-DD'),
       season_end   = to_char(valid_until, 'MM-DD')
 WHERE valid_from IS NOT NULL AND valid_until IS NOT NULL;

-- De un año o más: abarca todos los días del año.
UPDATE public.tour_pricing
   SET season_start = '01-01', season_end = '12-31'
 WHERE valid_from IS NOT NULL
   AND valid_until >= (valid_from + interval '1 year' - interval '1 day')::date;

-- Vencidas: se convertirían en una temporada que vuelve a cobrarse cada año. Cada una queda en un
-- NOTICE, para poder reactivarla si hiciera falta.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    UPDATE public.tour_pricing
       SET active = false
     WHERE active
       AND valid_until IS NOT NULL
       AND valid_until < (now() AT TIME ZONE 'America/Costa_Rica')::date
    RETURNING id
  LOOP
    RAISE NOTICE 'tour_pricing %: temporada vencida, queda inactiva', r.id;
  END LOOP;
END;
$$;

-- Choques tras la conversión: por tour y tiquete queda la vigente hoy o, si no, la que empieza
-- antes; las que chocan con una ya conservada pasan a inactivas.
DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Costa_Rica')::date;
  r       record;
  v_kept  uuid[] := '{}';
BEGIN
  FOR r IN
    SELECT p.id, p.tour_id, p.ticket_type, p.season_start, p.season_end
    FROM public.tour_pricing p
    WHERE p.active AND p.season_start IS NOT NULL
    ORDER BY p.tour_id, p.ticket_type,
             (v_today BETWEEN p.valid_from AND p.valid_until) DESC,
             p.valid_from, p.id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.tour_pricing k
      WHERE k.tour_id = r.tour_id AND k.ticket_type = r.ticket_type AND k.id <> r.id
        AND k.active AND k.season_start IS NOT NULL
        AND k.id = ANY (v_kept)
        AND public.tour_pricing_seasons_overlap(k.season_start, k.season_end, r.season_start, r.season_end)
    ) THEN
      UPDATE public.tour_pricing SET active = false WHERE id = r.id;
      RAISE NOTICE 'tour_pricing %: temporada inactiva por superposición tras la conversión', r.id;
    ELSE
      v_kept := v_kept || r.id;
    END IF;
  END LOOP;
END;
$$;

-- ================================================================
-- 4. Restricciones
-- ================================================================

ALTER TABLE public.tour_pricing
  ADD CONSTRAINT tour_pricing_season_shape CHECK (
    (season_start IS NULL AND season_end IS NULL)
    OR (season_start IS NOT NULL AND season_end IS NOT NULL AND season_label IS NOT NULL)
  ),
  ADD CONSTRAINT tour_pricing_season_days CHECK (
    season_start IS NULL OR (
      CASE
        WHEN season_start ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
         AND season_end   ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        THEN substr(season_start, 4, 2)::integer
               <= (ARRAY[31,29,31,30,31,30,31,31,30,31,30,31])[substr(season_start, 1, 2)::integer]
         AND substr(season_end, 4, 2)::integer
               <= (ARRAY[31,29,31,30,31,30,31,31,30,31,30,31])[substr(season_end, 1, 2)::integer]
        ELSE false
      END
    )
  );

ALTER TABLE public.tour_pricing DROP CONSTRAINT tour_pricing_no_seasonal_overlap;

DROP INDEX public.tour_pricing_one_base_per_type;
CREATE UNIQUE INDEX tour_pricing_one_base_per_type
  ON public.tour_pricing (tour_id, ticket_type)
  WHERE active AND season_start IS NULL;

-- ================================================================
-- 5. Superposición al confirmar
-- ================================================================

CREATE FUNCTION public.tour_pricing_check_season_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.tour_pricing;
BEGIN
  -- El trigger es diferido: se relee la fila en su estado final (pudo cambiar o borrarse después
  -- del evento en la misma transacción). Supone READ COMMITTED: con REPEATABLE READ o
  -- SERIALIZABLE el lock ya no garantiza ver lo que confirmó el otro guardado.
  SELECT * INTO v_row FROM public.tour_pricing WHERE id = NEW.id;
  IF NOT FOUND OR NOT v_row.active OR v_row.season_start IS NULL THEN
    RETURN NULL;
  END IF;

  -- Serializa dos guardados del mismo tour: en READ COMMITTED, el segundo ve lo que confirmó el
  -- primero.
  PERFORM pg_advisory_xact_lock(hashtext('tour_pricing:' || v_row.tour_id::text));

  IF EXISTS (
    SELECT 1 FROM public.tour_pricing p
    WHERE p.tour_id = v_row.tour_id
      AND p.ticket_type = v_row.ticket_type
      AND p.id <> v_row.id
      AND p.active
      AND p.season_start IS NOT NULL
      AND public.tour_pricing_seasons_overlap(
            p.season_start, p.season_end, v_row.season_start, v_row.season_end)
  ) THEN
    RAISE EXCEPTION 'tour_pricing_season_overlap' USING ERRCODE = '23P01';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tour_pricing_check_season_overlap()
  FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER tour_pricing_season_overlap
  AFTER INSERT OR UPDATE ON public.tour_pricing
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tour_pricing_check_season_overlap();
