-- Migration: constraints e índices de integridad (spec 0028, workstream B, ítem B2).
-- Cierra hallazgos del code review integral 2026-07-06:
--   - Nada garantizaba UN precio vigente por (tour, ticket_type): dos temporadas activas
--     solapadas (o dos precios base) hacían el monto cobrado no determinista.
--   - `currency` era text libre (los reportes agregan con MAX(currency)).
--   - La PK compuesta de tour_instance_guides permitía dos guías concurrentes en la misma
--     salida (regla MVP: un guía por salida).
--   - 6 FKs sin índice de soporte y la anonimización (…034) filtra por lower(customer_email)
--     sin índice funcional (seq scan).
--
-- Semántica de precios (decisión del spec 0028 §5-B1): un precio BASE (sin fechas) por
-- (tour, ticket_type) convive con TEMPORADAS (con fechas); la temporada gana. En DB:
--   - EXCLUDE anti-solape SOLO entre filas con al menos un límite de fecha (bounds
--     inclusivos '[]'). NOTA (review pre-PR): el CHECK valid_season_range (…005) sigue
--     siendo AUTORITATIVO y exige ambas fechas o ninguna — las temporadas semi-abiertas
--     están prohibidas hoy y la app las rechaza con código propio
--     (tour_season_dates_incomplete). El EXCLUDE trata un límite NULL como infinito solo
--     como defensa futura: si algún día se relaja ese CHECK, hay que ajustar además el
--     filtro de vigencia de lib/pricing/active-filter.ts (su OR asume valid_from NULL =
--     precio base) y el CHECK season_label_required_with_dates.
--   - UNIQUE parcial: una sola fila base activa por (tour_id, ticket_type).
-- La prioridad temporada>base la resuelve la app en un único punto (lib/pricing), con
-- tie-break determinista que no depende de este constraint.
--
-- Deploy: la DB de prod aún no tiene datos reales (pre-cutover) → sin NOT VALID ni
-- CONCURRENTLY. Si algún entorno tuviera datos en conflicto, la migración falla explícita
-- y se limpian antes de reintentar (el seed actual pasa tal cual).
--
-- Reversibilidad: DROP de cada constraint/índice por nombre; la extensión btree_gist se
-- conserva (inocua). Sin cambios de datos.

-- En el schema `extensions` (convención Supabase): en `public`, las ~376 funciones de
-- soporte de btree_gist quedarían ejecutables por anon/authenticated y disparan la
-- auditoría de regresión de grants (0018/0019). Los operadores del EXCLUDE se resuelven
-- vía search_path en el DDL (Supabase incluye `extensions`) y quedan ligados por OID.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ----------------------------------------------------------------
-- 1. tour_pricing: temporadas sin solape + un solo precio base activo.
-- ----------------------------------------------------------------
ALTER TABLE public.tour_pricing ADD CONSTRAINT tour_pricing_no_seasonal_overlap
  EXCLUDE USING gist (
    tour_id WITH =,
    ticket_type WITH =,
    daterange(valid_from, valid_until, '[]') WITH &&
  )
  WHERE (active AND (valid_from IS NOT NULL OR valid_until IS NOT NULL));

CREATE UNIQUE INDEX tour_pricing_one_base_per_type
  ON public.tour_pricing (tour_id, ticket_type)
  WHERE active AND valid_from IS NULL AND valid_until IS NULL;

-- ----------------------------------------------------------------
-- 2. currency: dominio cerrado (USD/CRC). Los montos son integer cents; la moneda
--    viaja aparte y los reportes hoy agregan con MAX(currency) — un valor basura
--    descuadraría contabilidad en silencio.
-- ----------------------------------------------------------------
ALTER TABLE public.bookings ADD CONSTRAINT bookings_currency_check
  CHECK (currency IN ('USD', 'CRC'));
ALTER TABLE public.payments ADD CONSTRAINT payments_currency_check
  CHECK (currency IN ('USD', 'CRC'));
ALTER TABLE public.refunds ADD CONSTRAINT refunds_currency_check
  CHECK (currency IN ('USD', 'CRC'));

-- ----------------------------------------------------------------
-- 3. Un guía por salida (regla MVP) a nivel DB. Habilita el upsert atómico
--    ON CONFLICT (tour_instance_id) en assignGuide (B9) y elimina la race
--    delete+insert que dejaba dos guías.
-- ----------------------------------------------------------------
CREATE UNIQUE INDEX tour_instance_guides_one_guide_per_instance
  ON public.tour_instance_guides (tour_instance_id);

-- ----------------------------------------------------------------
-- 4. Índices de soporte de FKs sin índice + funcional para la anonimización.
-- ----------------------------------------------------------------
CREATE INDEX bookings_hold_id_idx ON public.bookings (hold_id);
CREATE INDEX bookings_checked_in_by_idx ON public.bookings (checked_in_by);
CREATE INDEX refunds_payment_id_idx ON public.refunds (payment_id);
CREATE INDEX audit_logs_actor_id_idx ON public.audit_logs (actor_id);
CREATE INDEX notifications_guide_id_idx ON public.notifications (guide_id);
CREATE INDEX tour_instance_guides_assigned_by_idx ON public.tour_instance_guides (assigned_by);
-- La purga de PII (…034) filtra por lower(customer_email); sin esto es seq scan.
CREATE INDEX bookings_customer_email_lower_idx ON public.bookings (lower(customer_email));
