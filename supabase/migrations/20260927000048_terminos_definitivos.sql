-- Migration: términos definitivos y publicación de los textos legales (spec 0034).
--
--   1. business_settings: identidad del operador y tolerancia de llegada tarde, editables desde el
--      panel. Los términos, el aviso de privacidad, el pie del sitio, el pie de los correos y el
--      resumen de compra los leen de acá: un solo lugar para un dato que aparece en cinco.
--   2. bookings.no_show_tolerance_minutes: la tolerancia vigente al crear la reserva. Los términos
--      no llevan el número (dicen "la indicada en el resumen de compra y en su correo de
--      confirmación"), así que cambiarlo desde el panel no altera lo que aceptó cada turista.
--   3. refunds: la comisión descontada es siempre 0 (reembolsos completos).
--   4. tours: qué no incluye, requisitos y edades del tiquete de niño, que la cláusula 3 de los
--      términos promete publicar.
--
-- Orden de despliegue: antes del código. Todo es aditivo y con default: el código anterior sigue
-- funcionando con esta migración aplicada.
--
-- Reversibilidad: DROP TRIGGER bookings_set_no_show_tolerance y su función; DROP CONSTRAINT
-- refunds_no_processing_fee_check; restaurar cancel_booking de …046; DROP de las columnas nuevas
-- (el DROP ya quita sus grants). No revertir bookings.no_show_tolerance_minutes una vez que haya
-- reservas con estos términos: es la evidencia de la tolerancia que aceptó cada turista.

SET LOCAL lock_timeout = '5s';

-- ================================================================
-- 1. Identidad del operador y tolerancia
-- ================================================================

-- Vacío = no cargado todavía. La web no abre la venta mientras falte un dato obligatorio
-- (declaratoria del ICT y póliza son opcionales: su frase solo aparece si existen).
ALTER TABLE public.business_settings
  ADD COLUMN operator_legal_name           text    NOT NULL DEFAULT '',
  ADD COLUMN operator_tax_id               text    NOT NULL DEFAULT '',
  ADD COLUMN operator_address              text    NOT NULL DEFAULT '',
  ADD COLUMN operator_brand                text    NOT NULL DEFAULT '',
  ADD COLUMN operator_contact_email        text    NOT NULL DEFAULT '',
  ADD COLUMN operator_privacy_email        text    NOT NULL DEFAULT '',
  ADD COLUMN operator_phone                text    NOT NULL DEFAULT '',
  ADD COLUMN operator_hours                text    NOT NULL DEFAULT '',
  ADD COLUMN operator_ict_declaration      text    NOT NULL DEFAULT '',
  ADD COLUMN operator_has_liability_policy boolean NOT NULL DEFAULT false,
  ADD COLUMN no_show_tolerance_minutes     integer NOT NULL DEFAULT 15,
  ADD CONSTRAINT business_settings_no_show_tolerance_check
    CHECK (no_show_tolerance_minutes BETWEEN 0 AND 120);

-- Mismo patrón que …043: la RLS limita la escritura a admin y el grant de columna limita qué
-- puede tocar authenticated.
GRANT UPDATE (
  operator_legal_name, operator_tax_id, operator_address, operator_brand,
  operator_contact_email, operator_privacy_email, operator_phone, operator_hours,
  operator_ict_declaration, operator_has_liability_policy, no_show_tolerance_minutes
) ON public.business_settings TO authenticated;

-- ================================================================
-- 2. Tolerancia copiada a cada reserva
-- ================================================================

-- NULL en las reservas anteriores a esta versión de los términos.
ALTER TABLE public.bookings
  ADD COLUMN no_show_tolerance_minutes integer NULL,
  ADD CONSTRAINT bookings_no_show_tolerance_check
    CHECK (no_show_tolerance_minutes IS NULL OR no_show_tolerance_minutes BETWEEN 0 AND 120);

-- Un trigger y no un argumento más: la reserva del cobro inmediato se inserta desde la web y la
-- del diferido desde create_deferred_booking. Así los dos flujos copian el mismo valor sin
-- cambiar la firma de la función ni depender de que el llamador lo pase. SECURITY DEFINER para
-- leer la configuración sin depender de la RLS ni de los grants de quien inserta.
CREATE FUNCTION public.set_booking_no_show_tolerance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.no_show_tolerance_minutes IS NULL THEN
    SELECT s.no_show_tolerance_minutes INTO NEW.no_show_tolerance_minutes
      FROM public.business_settings s
      WHERE s.id = 1;
    -- Sin la fila de configuración la reserva quedaría sin la tolerancia que promete el resumen
    -- de compra: mejor no venderla (igual que …044 y …047 con la misma fila).
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUSINESS_SETTINGS_MISSING';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_booking_no_show_tolerance() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER bookings_set_no_show_tolerance
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_booking_no_show_tolerance();

-- ================================================================
-- 3. Reembolsos siempre completos
-- ================================================================

-- Decisión del operador del 2026-09-27: nunca se descuenta la comisión del procesador. La app ya
-- no la calcula; el CHECK lo garantiza también frente a un llamador que pase p_fee_cents > 0 a
-- cancel_booking. Producción no tiene filas con comisión (la política del spec 0032 nunca se
-- activó), así que valida al instante.
ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_no_processing_fee_check CHECK (processing_fee_cents = 0);

-- cancel_booking de …046 con las reglas en la base: comisión siempre 0 (INVALID_FEE, antes de
-- llegar al CHECK) y la cancelación del turista reembolsa el total o nada. Misma firma: los
-- grants de …046 se conservan.
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id          uuid,
  p_actor_type          text,
  p_refund_amount_cents integer,
  p_reason              text,
  p_fee_cents           integer,
  p_actor_id            uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
  v_seats   integer;
  v_payment public.payments;
  v_refund_cents integer;
  v_fee_cents integer;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN ('customer_request', 'operator_decision') THEN
    RAISE EXCEPTION 'INVALID_REASON';
  END IF;

  -- Reembolsos completos (spec 0034): nunca se descuenta una comisión.
  IF p_fee_cents IS NULL OR p_fee_cents <> 0 THEN
    RAISE EXCEPTION 'INVALID_FEE';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  -- Ya cancelada o nunca confirmada: el llamador lo informa en vez de mostrar un monto que no se
  -- aplicó (dos cancelaciones concurrentes).
  IF v_booking.status <> 'confirmed' THEN
    RETURN 'already_cancelled';
  END IF;

  -- Invariantes de monto (después del chequeo de estado: una segunda cancelación sigue
  -- devolviendo 'already_cancelled'). La decisión del operador reembolsa el total, y el monto más
  -- la comisión nunca superan el total de la reserva.
  IF p_reason = 'operator_decision'
     AND p_refund_amount_cents <> v_booking.total_amount_cents THEN
    RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
  END IF;

  -- La cancelación del turista es todo o nada: el total con 24 h o más, cero con menos.
  IF p_reason = 'customer_request'
     AND p_refund_amount_cents NOT IN (0, v_booking.total_amount_cents) THEN
    RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
  END IF;

  IF p_refund_amount_cents < 0
     OR p_refund_amount_cents + p_fee_cents > v_booking.total_amount_cents THEN
    RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
  END IF;

  v_seats := v_booking.tickets_adult + v_booking.tickets_child + v_booking.tickets_student;

  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved - v_seats
    WHERE id = v_booking.tour_instance_id;

  UPDATE public.notifications
    SET status = 'cancelled', cancelled_reason = 'booking_cancelled'
    WHERE booking_id = p_booking_id
      AND kind = 'reminder_24h'
      AND status = 'pending';

  INSERT INTO public.notifications (
    booking_id, kind, recipient_email, locale, scheduled_for
  )
  VALUES (
    p_booking_id, 'cancellation_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor_type, p_actor_id, 'booking.cancelled', 'booking', p_booking_id,
    jsonb_build_object(
      'refund_amount_cents', p_refund_amount_cents,
      'seats', v_seats,
      'reason', p_reason,
      'fee_cents', p_fee_cents
    )
  );

  IF p_refund_amount_cents > 0 THEN
    SELECT * INTO v_payment
      FROM public.payments
      WHERE booking_id = p_booking_id AND status = 'succeeded'
      ORDER BY created_at DESC
      LIMIT 1;

    IF FOUND THEN
      -- Se encola el monto que dictó la política, capado a lo efectivamente cobrado (…042). Si
      -- el tope recorta el monto, la comisión guardada se recorta también, para que reembolso +
      -- comisión nunca superen lo cobrado.
      v_refund_cents := LEAST(p_refund_amount_cents, v_payment.amount_cents);
      v_fee_cents := LEAST(p_fee_cents, v_payment.amount_cents - v_refund_cents);

      INSERT INTO public.refunds (
        booking_id, payment_id, amount_cents, currency, reason, processing_fee_cents
      )
      VALUES (
        p_booking_id, v_payment.id, v_refund_cents, v_payment.currency,
        'requested_by_customer', v_fee_cents
      )
      ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;

      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.requested', 'booking', p_booking_id,
        jsonb_build_object(
          'amount_cents', v_refund_cents,
          'currency', v_payment.currency,
          'fee_cents', v_fee_cents
        )
      );
    ELSE
      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.skipped_no_payment', 'booking', p_booking_id, '{}'
      );
    END IF;
  END IF;

  RETURN 'cancelled';
END;
$$;

-- ================================================================
-- 4. Información del tour que publican los términos
-- ================================================================

ALTER TABLE public.tours
  ADD COLUMN excludes_es     text    NOT NULL DEFAULT '',
  ADD COLUMN excludes_en     text    NOT NULL DEFAULT '',
  ADD COLUMN requirements_es text    NOT NULL DEFAULT '',
  ADD COLUMN requirements_en text    NOT NULL DEFAULT '',
  ADD COLUMN child_age_min   integer NULL,
  ADD COLUMN child_age_max   integer NULL,
  ADD CONSTRAINT tours_child_ages_check
    CHECK (
      (child_age_min IS NULL AND child_age_max IS NULL)
      OR (child_age_min IS NOT NULL AND child_age_max IS NOT NULL
          AND child_age_min >= 0 AND child_age_min <= child_age_max AND child_age_max < 18)
    );
