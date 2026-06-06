-- 0012 — Reportes básicos.
--
-- Tres funciones SQL de solo lectura que agregan los datos de los reportes, más
-- dos índices parciales para sostener los filtros por fecha. Las funciones son
-- SECURITY INVOKER: corren con el rol del que las llama (la sesión autenticada
-- del admin/staff), así las RLS de admin/staff sobre las tablas base aplican
-- como defensa en profundidad. La autorización primaria es el guard de ruta
-- requireAnyRole(ADMIN_PANEL_ROLES) en la capa web.
--
-- Convención de rango: medio-abierto [p_from, p_to). La capa web pasa
-- p_from = inicio del día "desde" y p_to = inicio del día siguiente al "hasta"
-- (en horario de Costa Rica), de modo que el día "hasta" queda incluido.
--
-- Reversibilidad: forward-only. Revertir: DROP de las 3 funciones y 2 índices.

-- ----------------------------------------------------------------
-- Índices parciales para los filtros por fecha de los agregados.
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS payments_succeeded_created_idx
  ON public.payments (created_at) WHERE status = 'succeeded';

CREATE INDEX IF NOT EXISTS refunds_succeeded_created_idx
  ON public.refunds (created_at) WHERE status = 'succeeded';

-- Grants defensivos: las funciones INVOKER necesitan SELECT sobre estas tablas
-- para la sesión autenticada. Idempotente (Supabase ya concede por defecto).
GRANT SELECT ON public.refunds TO authenticated;
GRANT SELECT ON public.tours   TO authenticated;

-- ----------------------------------------------------------------
-- report_revenue: ingresos por tour, por fecha de PAGO (criterio de caja).
-- Bruto = pagos succeeded; reembolsado = refunds succeeded (por su propia
-- fecha); neto = bruto - reembolsado. Solo tours con movimiento en el rango.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_revenue(p_from timestamptz, p_to timestamptz)
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
    WHERE p.status = 'succeeded'
      AND p.created_at >= p_from AND p.created_at < p_to
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
      AND r.created_at >= p_from AND r.created_at < p_to
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

-- ----------------------------------------------------------------
-- report_occupancy: reservas/ocupación/no-show por tour, por fecha de SALIDA.
-- La capacidad se agrega aparte de las reservas para no inflarla con el join.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_occupancy(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  tour_id            uuid,
  name_es            text,
  name_en            text,
  bookings_count     bigint,
  tickets_sold       bigint,
  capacity_total     bigint,
  occupancy_pct      numeric,
  no_show_count      bigint,
  past_bookings_count bigint
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  WITH inst AS (
    SELECT ti.id, ti.tour_id, ti.capacity_total, ti.starts_at
    FROM public.tour_instances ti
    WHERE ti.starts_at >= p_from AND ti.starts_at < p_to
  ),
  caps AS (
    SELECT tour_id, SUM(capacity_total)::bigint AS capacity_total
    FROM inst GROUP BY tour_id
  ),
  bk AS (
    SELECT
      i.tour_id,
      COUNT(*) FILTER (WHERE b.status = 'confirmed')::bigint AS bookings_count,
      COALESCE(SUM(b.tickets_adult + b.tickets_child + b.tickets_student)
        FILTER (WHERE b.status = 'confirmed'), 0)::bigint AS tickets_sold,
      COUNT(*) FILTER (
        WHERE b.status = 'confirmed' AND i.starts_at < now() AND b.checked_in_at IS NULL
      )::bigint AS no_show_count,
      COUNT(*) FILTER (
        WHERE b.status = 'confirmed' AND i.starts_at < now()
      )::bigint AS past_bookings_count
    FROM inst i
    JOIN public.bookings b ON b.tour_instance_id = i.id
    GROUP BY i.tour_id
  )
  SELECT
    t.id,
    t.name_es,
    t.name_en,
    COALESCE(bk.bookings_count, 0),
    COALESCE(bk.tickets_sold, 0),
    COALESCE(caps.capacity_total, 0),
    CASE
      WHEN COALESCE(caps.capacity_total, 0) = 0 THEN NULL
      ELSE ROUND(COALESCE(bk.tickets_sold, 0)::numeric / caps.capacity_total, 4)::double precision
    END,
    COALESCE(bk.no_show_count, 0),
    COALESCE(bk.past_bookings_count, 0)
  FROM public.tours t
  JOIN caps        ON caps.tour_id = t.id
  LEFT JOIN bk     ON bk.tour_id = t.id
  ORDER BY 4 DESC;
$$;

-- ----------------------------------------------------------------
-- report_refunds_summary: totales de reembolsos (por fecha de refund) y base de
-- la tasa de cancelación (reservas de salidas del rango). Una sola fila.
-- Cancelada = status IN ('cancelled','refunded'); válidas excluyen pending_payment.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_refunds_summary(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  refunds_count        bigint,
  refunds_amount_cents bigint,
  cancelled_count      bigint,
  valid_bookings_count bigint,
  currency             text
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT
      COUNT(*)::bigint                  AS refunds_count,
      COALESCE(SUM(amount_cents), 0)::bigint AS refunds_amount_cents,
      MAX(currency)                     AS currency
    FROM public.refunds
    WHERE status = 'succeeded'
      AND created_at >= p_from AND created_at < p_to
  ),
  bk AS (
    SELECT
      COUNT(*) FILTER (WHERE b.status IN ('cancelled', 'refunded'))::bigint AS cancelled_count,
      COUNT(*) FILTER (
        WHERE b.status IN ('confirmed', 'cancelled', 'refunded')
      )::bigint AS valid_bookings_count
    FROM public.bookings b
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    WHERE ti.starts_at >= p_from AND ti.starts_at < p_to
  )
  SELECT r.refunds_count, r.refunds_amount_cents,
         bk.cancelled_count, bk.valid_bookings_count,
         COALESCE(r.currency, 'USD')
  FROM r, bk;
$$;

REVOKE EXECUTE ON FUNCTION public.report_revenue(timestamptz, timestamptz)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.report_occupancy(timestamptz, timestamptz)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.report_refunds_summary(timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.report_revenue(timestamptz, timestamptz)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_occupancy(timestamptz, timestamptz)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_refunds_summary(timestamptz, timestamptz) TO authenticated;
