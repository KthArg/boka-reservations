-- Migration: guard de payment_mismatch dentro de confirm_booking (spec 0026, ítem 2).
--
-- Defensa en profundidad: hoy la validación de monto/moneda (spec 0014) la hacen los CALLERS
-- (webhook + reconciliación) ANTES de llamar confirm_booking; si un 3er caller futuro (p. ej.
-- "confirmar a mano" en el panel) olvidara validar, podría confirmarse un pago con monto
-- incorrecto. Este guard centraliza el chequeo dentro de confirm_booking: si el monto/moneda
-- pagados no coinciden con payments.amount_cents/currency, NO confirma → la reserva queda en
-- `payment_mismatch` con el mismo audit `booking.payment_mismatch` que emite flag_payment_mismatch
-- (preserva la trazabilidad). El pago NO se toca (queda `pending`, no cuenta como ingreso),
-- igual que flag_payment_mismatch (0014).
--
-- Cambia la FIRMA de confirm_booking: agrega p_paid_amount_cents / p_paid_currency (ambos
-- DEFAULT NULL → el guard solo corre si el caller los pasa; aditivo, no rompe un 3-arg legacy).
-- Como la aridad cambia, Postgres trataría un CREATE OR REPLACE como un overload nuevo: hay que
-- DROPear la firma de 4 args de …036 y CREAR la de 6 args. Ambos callers pasan named params
-- (supabase-js .rpc), así que el orden de los nuevos parámetros no los afecta.
--
-- Orden interno (spec 0026 §5): (1) idempotencia por estado (terminal → RETURN),
-- (2) mismatch de monto [este ítem], (3) capacidad/overbooked_refunded (spec 0025), (4) confirmar.
-- El mismatch va ANTES del lock de capacidad y ANTES de marcar el pago succeeded: no tiene
-- sentido evaluar cupo ni dar por bueno un pago de monto incorrecto.
--
-- Reversibilidad: forward-only. Para revertir, DROP de la firma de 6 args y restaurar el cuerpo
-- de 4 args de …036 (requiere que ningún caller pase ya los 2 parámetros nuevos).

DROP FUNCTION IF EXISTS public.confirm_booking(uuid, text, integer, text);

CREATE OR REPLACE FUNCTION public.confirm_booking(
  p_booking_id          uuid,
  p_external_payment_id text,
  p_total_seats         integer,
  p_event_id            text DEFAULT NULL,
  p_paid_amount_cents   integer DEFAULT NULL,
  p_paid_currency       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking           public.bookings;
  v_capacity_total    integer;
  v_capacity_reserved integer;
  v_payment           public.payments;
  v_expected          public.payments;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_event_id IS NOT NULL THEN
    INSERT INTO public.processed_webhook_events (id)
      VALUES (p_event_id)
      ON CONFLICT (id) DO NOTHING;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  -- (1) Idempotencia/gate por estado (spec 0025 + 0026): confirm_booking SOLO actúa sobre una
  -- reserva `pending_payment`. Cualquier otro estado es un no-op idempotente: terminales del pago
  -- (`confirmed`/`overbooked_refunded`/`payment_mismatch`) y también `cancelled`/`refunded` —
  -- así un webhook/reconciliación tardío NO resucita una reserva cancelada ni pisa un terminal.
  -- Espeja el gate `status='pending_payment'` de flag_payment_mismatch (0014). Crítico porque el
  -- reconciliador llama confirm_booking SIN p_event_id (la idempotencia por
  -- processed_webhook_events no aplica): este gate por estado es la única defensa contra un
  -- segundo refund o una re-evaluación de mismatch sobre una reserva ya resuelta.
  IF v_booking.status <> 'pending_payment' THEN
    RETURN;
  END IF;

  -- (2) Mismatch de monto (spec 0026, ítem 2 / defensa en profundidad de 0014). Solo corre si el
  -- caller pasó el monto/moneda pagados; si no, se preserva el comportamiento previo (aditivo).
  -- Compara contra el pago esperado de ESTA confirmación (booking_id + external_payment_id);
  -- moneda normalizada a mayúsculas (ISO 4217 case-insensitive). En mismatch: NO confirma, NO
  -- toca el pago (queda `pending`), deja la reserva en `payment_mismatch` y audita igual que
  -- flag_payment_mismatch (source='confirm_booking'). Si no hay pago que comparar, se omite el
  -- guard (el camino normal maneja el caso sin-pago).
  IF p_paid_amount_cents IS NOT NULL AND p_paid_currency IS NOT NULL THEN
    SELECT * INTO v_expected
      FROM public.payments
      WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;

    IF FOUND AND (
      p_paid_amount_cents <> v_expected.amount_cents
      OR UPPER(p_paid_currency) <> UPPER(v_expected.currency)
    ) THEN
      UPDATE public.bookings SET status = 'payment_mismatch' WHERE id = p_booking_id;

      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'booking.payment_mismatch', 'booking', p_booking_id,
        jsonb_build_object(
          'expected_amount_cents', v_expected.amount_cents,
          'expected_currency', v_expected.currency,
          'paid_amount_cents', p_paid_amount_cents,
          'paid_currency', p_paid_currency,
          'source', 'confirm_booking'
        )
      );

      RETURN;
    END IF;
  END IF;

  -- Lock + lectura de la instancia para comparar el cupo de forma consistente ante
  -- confirmaciones concurrentes (dos pagos por el último asiento serializan acá).
  SELECT capacity_total, capacity_reserved
    INTO v_capacity_total, v_capacity_reserved
    FROM public.tour_instances
    WHERE id = v_booking.tour_instance_id
    FOR UPDATE;

  -- El turista pagó: en ambos caminos el pago queda succeeded (en el de sobreventa, para
  -- que el refund tenga un pago succeeded que reembolsar). DEBE quedar antes del branch y
  -- dentro del lock de la instancia: no mover después del RETURN del camino de sobreventa.
  UPDATE public.payments SET status = 'succeeded'
    WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;

  -- (3) Capa 2 — sobreventa: confirmar superaría capacity_total. NO se confirma; reserva
  -- terminal overbooked_refunded + refund total. No se incrementa capacity_reserved.
  IF v_capacity_reserved + p_total_seats > v_capacity_total THEN
    UPDATE public.bookings SET status = 'overbooked_refunded' WHERE id = p_booking_id;

    IF v_booking.hold_id IS NOT NULL THEN
      UPDATE public.tour_holds SET status = 'released' WHERE id = v_booking.hold_id;
    END IF;

    -- Encolar el refund total (patrón de cancel_booking …029): a lo sumo un refund activo
    -- por reserva (índice refunds_one_active_per_booking). Lo procesa process-refunds.
    -- IF FOUND es defensivo: el pago se acaba de marcar succeeded por (booking_id,
    -- external_payment_id), así que normalmente existe; si faltara, la reserva igual queda
    -- overbooked_refunded (preserva la invariante) y el audit deja refund_amount_cents=0.
    SELECT * INTO v_payment
      FROM public.payments
      WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;

    IF FOUND THEN
      INSERT INTO public.refunds (booking_id, payment_id, amount_cents, currency, reason)
      VALUES (
        p_booking_id, v_payment.id, v_payment.amount_cents, v_payment.currency,
        'overbooked_refunded'
      )
      ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;
    END IF;

    INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      'system', 'booking.overbooked_refunded', 'booking', p_booking_id,
      jsonb_build_object(
        'capacity_total', v_capacity_total,
        'capacity_reserved', v_capacity_reserved,
        'seats', p_total_seats,
        'refund_amount_cents', COALESCE(v_payment.amount_cents, 0),
        'currency', COALESCE(v_payment.currency, v_booking.currency)
      )
    );

    -- Notificar al turista: cupo agotado + reembolso en curso.
    INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
    VALUES (
      p_booking_id, 'overbooked_refunded',
      v_booking.customer_email, v_booking.locale, NOW()
    )
    ON CONFLICT (booking_id, kind) DO NOTHING;

    RETURN;
  END IF;

  -- (4) Camino feliz: hay cupo. Confirmar e incrementar capacity_reserved.
  UPDATE public.bookings SET status = 'confirmed' WHERE id = p_booking_id;

  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved + p_total_seats
    WHERE id = v_booking.tour_instance_id;

  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'converted' WHERE id = v_booking.hold_id;
  END IF;

  INSERT INTO public.notifications (
    booking_id, kind, recipient_email, locale, scheduled_for
  )
  VALUES (
    p_booking_id, 'booking_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.notifications (
    booking_id, kind, recipient_email, locale, scheduled_for
  )
  SELECT
    p_booking_id, 'reminder_24h',
    v_booking.customer_email, v_booking.locale,
    ti.starts_at - INTERVAL '24 hours'
  FROM public.tour_instances ti
  WHERE ti.id = v_booking.tour_instance_id
  ON CONFLICT (booking_id, kind) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer, text, integer, text)
  FROM PUBLIC, anon, authenticated;
