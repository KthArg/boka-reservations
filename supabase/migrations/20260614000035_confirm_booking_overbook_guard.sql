-- Migration: guard de sobreventa en confirm_booking (spec 0023, P2).
--
-- Si un hold vence (15 min) antes de que llegue el webhook, otro hold puede tomar el cupo y
-- ambas reservas confirmar, superando capacity_total. Esta migración NO rechaza un pago ya
-- hecho (el turista pagó): confirma igual, pero si la confirmación supera el cupo registra un
-- audit_logs `booking.overbooked` para que el operador lo gestione (reubicar, abrir cupo).
-- La alerta proactiva a Sentry la hacen los callers (webhook + reconciliación) re-leyendo la
-- capacidad después del confirm (sin cambiar la firma de esta función).
--
-- Reescribe confirm_booking preservando ÍNTEGRO el cuerpo vigente (migración …024/…029):
-- guard is_public_request, idempotencia in-tx (processed_webhook_events), guard de status,
-- hold→converted y las dos notificaciones. Solo agrega: lock + lectura de la instancia, el
-- chequeo de sobrecupo y el audit. Firma (args + RETURNS void) sin cambios.
--
-- Reversibilidad: forward-only. Para revertir, restaurar el cuerpo de la migración …029.

CREATE OR REPLACE FUNCTION public.confirm_booking(
  p_booking_id          uuid,
  p_external_payment_id text,
  p_total_seats         integer,
  p_event_id            text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking            public.bookings;
  v_capacity_total     integer;
  v_capacity_reserved  integer;
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

  IF v_booking.status = 'confirmed' THEN
    RETURN; -- ya confirmado, idempotente
  END IF;

  UPDATE public.bookings SET status = 'confirmed' WHERE id = p_booking_id;

  UPDATE public.payments SET status = 'succeeded'
    WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;

  -- Guard de sobreventa (spec 0023): lock + lectura de la instancia para comparar el cupo de
  -- forma consistente ante confirmaciones concurrentes. Si confirmar superaría capacity_total,
  -- se registra el sobrecupo (NO se rechaza el pago). Igual se incrementa capacity_reserved
  -- reflejando la realidad (no se capea), para que el conteo no mienta.
  SELECT capacity_total, capacity_reserved INTO v_capacity_total, v_capacity_reserved
    FROM public.tour_instances WHERE id = v_booking.tour_instance_id FOR UPDATE;

  IF v_capacity_reserved + p_total_seats > v_capacity_total THEN
    INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      'system', 'booking.overbooked', 'booking', p_booking_id,
      jsonb_build_object(
        'capacity_total', v_capacity_total,
        'capacity_reserved_before', v_capacity_reserved,
        'seats', p_total_seats,
        'capacity_reserved_after', v_capacity_reserved + p_total_seats
      )
    );
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer, text)
  FROM PUBLIC, anon, authenticated;
