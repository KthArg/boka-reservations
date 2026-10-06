-- Migración …059 — Ventana de "Salidas sin guía" configurable y criterio de fecha en el reporte
-- de ingresos (spec 0046).
--
--   1. business_settings.guide_warning_horizon_days: con cuántos días de anticipación avisa la
--      bandeja "Salidas sin guía" (spec 0043). Antes era una constante del código (14).
--   2. report_revenue suma p_basis: 'payment' (por defecto, el criterio de caja de siempre) o
--      'departure' (el rango se aplica a la fecha de inicio de la salida de cada reserva). Cambia
--      la firma, así que se reemplaza la función de dos argumentos por la de tres. Una llamada
--      con dos argumentos sigue funcionando por el valor por defecto: el código anterior no se
--      rompe entre esta migración y el deploy.
--
-- Permisos de report_revenue: los mismos de …022 y …028 (EXECUTE para authenticated, sin anon).
-- Sigue siendo SECURITY INVOKER: la lee la sesión del admin o del staff, bajo RLS.
--
-- Reversión, primero el código y después la base (el código nuevo envía p_basis): DROP FUNCTION
-- report_revenue(timestamptz, timestamptz, text); recrear la de dos argumentos con el cuerpo de
-- …046 y repetir REVOKE EXECUTE FROM PUBLIC, anon y GRANT a authenticated (un CREATE nuevo le
-- devuelve EXECUTE a anon); DROP COLUMN (se lleva el CHECK y el grant de columna).

SET lock_timeout = '5s';

ALTER TABLE public.business_settings
  ADD COLUMN guide_warning_horizon_days integer NOT NULL DEFAULT 14,
  ADD CONSTRAINT business_settings_guide_warning_horizon_days_check
    CHECK (guide_warning_horizon_days BETWEEN 1 AND 90);

GRANT UPDATE (guide_warning_horizon_days) ON public.business_settings TO authenticated;

DROP FUNCTION public.report_revenue(timestamptz, timestamptz);

-- Con 'departure' los dos subtotales siguen a la salida ACTUAL de la reserva: una reserva
-- cambiada de fecha cuenta en su salida nueva, y el reembolso de una reserva cuenta en el mismo
-- período que su pago. Cualquier otro valor de p_basis se trata como 'payment'.
CREATE FUNCTION public.report_revenue(
  p_from  timestamptz,
  p_to    timestamptz,
  p_basis text DEFAULT 'payment'
)
RETURNS TABLE (
  tour_id        uuid,
  name_es        text,
  name_en        text,
  gross_cents    bigint,
  refunded_cents bigint,
  net_cents      bigint,
  currency       text
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  WITH gross AS (
    SELECT ti.tour_id,
           SUM(p.amount_cents)::bigint AS gross_cents,
           MAX(p.currency)             AS currency
    FROM public.payments p
    JOIN public.bookings b        ON b.id = p.booking_id
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    -- 'refunded': el cobro existió; el reembolso se resta aparte (spec 0032).
    WHERE p.status IN ('succeeded', 'refunded')
      AND CASE WHEN p_basis = 'departure' THEN ti.starts_at ELSE p.created_at END >= p_from
      AND CASE WHEN p_basis = 'departure' THEN ti.starts_at ELSE p.created_at END <  p_to
    GROUP BY ti.tour_id
  ),
  refunded AS (
    SELECT ti.tour_id,
           SUM(r.amount_cents)::bigint AS refunded_cents,
           MAX(r.currency)             AS currency
    FROM public.refunds r
    JOIN public.bookings b        ON b.id = r.booking_id
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    WHERE r.status = 'succeeded'
      AND CASE WHEN p_basis = 'departure' THEN ti.starts_at ELSE r.created_at END >= p_from
      AND CASE WHEN p_basis = 'departure' THEN ti.starts_at ELSE r.created_at END <  p_to
    GROUP BY ti.tour_id
  )
  SELECT
    t.id,
    t.name_es,
    t.name_en,
    COALESCE(g.gross_cents, 0),
    COALESCE(rf.refunded_cents, 0),
    COALESCE(g.gross_cents, 0) - COALESCE(rf.refunded_cents, 0),
    COALESCE(g.currency, rf.currency, 'USD')
  FROM public.tours t
  JOIN (
    SELECT tour_id FROM gross
    UNION
    SELECT tour_id FROM refunded
  ) tt ON tt.tour_id = t.id
  LEFT JOIN gross g     ON g.tour_id = t.id
  LEFT JOIN refunded rf ON rf.tour_id = t.id
  ORDER BY 6 DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.report_revenue(timestamptz, timestamptz, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_revenue(timestamptz, timestamptz, text)
  TO authenticated;
