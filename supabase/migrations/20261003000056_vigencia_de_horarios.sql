-- Migración …056 — Vigencia de los horarios del tour: retiro de salidas fuera de vigencia (spec 0044).
--
--   1. tour_instances_cancellation_reason_check suma 'schedule_withdrawn': salida retirada porque su
--      horario se desactivó o porque su día quedó fuera de la vigencia del horario.
--   2. withdraw_schedule_instances(p_tour_id, p_actor_id): al guardar un tour, cancela sus salidas
--      futuras fuera de vigencia (o de horarios inactivos) que no tienen nada vivo encima, y cuenta
--      las que no pudo retirar. Nada vivo = sin reservas confirmed / pending_minimum /
--      pending_payment / payment_mismatch, sin apartados vivos (mismo criterio que create_hold_atomic) y sin un ciclo
--      del mínimo abierto (el motor del cobro diferido no mira salidas canceladas: una retención
--      viva quedaría sin dueño; es la misma regla del archivado de tours).
--
-- Concurrencia: las candidatas se bloquean con un solo SELECT … ORDER BY id FOR UPDATE, el orden
-- de reschedule_booking (…049), y las condiciones se evalúan bajo ese lock. create_hold_atomic
-- toma la misma fila y rechaza una salida cancelada.
--
-- Hardening: SECURITY DEFINER + search_path = '' + guard is_public_request() + REVOKE de PUBLIC,
-- anon, authenticated + GRANT a service_role. Exige que el actor sea un admin activo (solo el admin
-- edita tours).
--
-- Reversión: DROP FUNCTION withdraw_schedule_instances; pasar las salidas con motivo
-- 'schedule_withdrawn' a 'other' y recrear el CHECK de …049. Para reabrir una salida retirada,
-- UPDATE … SET status = 'available' (el trigger de …049 limpia el motivo).

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.tour_instances
  DROP CONSTRAINT tour_instances_cancellation_reason_check,
  ADD CONSTRAINT tour_instances_cancellation_reason_check
    CHECK (
      cancellation_reason IN (
        'minimum', 'weather', 'safety', 'force_majeure', 'other', 'schedule_withdrawn'
      )
    );

CREATE FUNCTION public.withdraw_schedule_instances(p_tour_id uuid, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
-- Una salida retenida por otra transacción no deja colgado el guardado del tour: falla y volver a
-- guardar lo reintenta (es idempotente).
SET lock_timeout = '5s'
AS $$
DECLARE
  v_instance  public.tour_instances;
  v_schedule  public.tour_schedules;
  v_reason    text;
  v_withdrawn integer := 0;
  v_kept      integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role = 'admin' AND u.active
  ) THEN
    RAISE EXCEPTION 'INVALID_ACTOR';
  END IF;

  -- Candidatas: futuras, no canceladas, de un horario inactivo o con el día (Costa Rica) fuera de
  -- la vigencia, con bordes inclusivos (espejo de withinValidity del generador). Un solo SELECT
  -- ordenado por id: el mismo orden de locks que reschedule_booking.
  FOR v_instance IN
    SELECT ti.*
      FROM public.tour_instances ti
      JOIN public.tour_schedules s ON s.id = ti.schedule_id
      WHERE ti.tour_id = p_tour_id
        AND ti.starts_at > now()
        AND ti.status <> 'cancelled'
        AND (
          NOT s.active
          OR (ti.starts_at AT TIME ZONE 'America/Costa_Rica')::date < s.valid_from
          OR (s.valid_until IS NOT NULL
              AND (ti.starts_at AT TIME ZONE 'America/Costa_Rica')::date > s.valid_until)
        )
      ORDER BY ti.id
      FOR UPDATE OF ti
  LOOP
    IF EXISTS (
         SELECT 1 FROM public.bookings b
         WHERE b.tour_instance_id = v_instance.id
           -- payment_mismatch: el turista pagó y su reserva espera revisión manual.
           AND b.status IN ('confirmed', 'pending_minimum', 'pending_payment', 'payment_mismatch')
       )
       OR EXISTS (
         SELECT 1 FROM public.tour_holds h
         WHERE h.tour_instance_id = v_instance.id
           AND ((h.status = 'active' AND h.expires_at > now()) OR h.status = 'paying')
       )
       OR (
         v_instance.minimum_charge_triggered_at IS NOT NULL
         AND v_instance.minimum_resolved_at IS NULL
         AND v_instance.minimum_charge_closed_at IS NULL
       ) THEN
      v_kept := v_kept + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_schedule FROM public.tour_schedules WHERE id = v_instance.schedule_id;
    v_reason := CASE WHEN v_schedule.active THEN 'out_of_validity' ELSE 'schedule_inactive' END;

    UPDATE public.tour_instances
      SET status = 'cancelled', cancellation_reason = 'schedule_withdrawn'
      WHERE id = v_instance.id;

    -- Un aviso de asignación al guía todavía sin enviar ya no tiene salida que anunciar.
    UPDATE public.notifications
      SET status = 'cancelled', cancelled_reason = 'departure_withdrawn'
      WHERE tour_instance_id = v_instance.id
        AND kind = 'guide_assignment'
        AND status = 'pending';

    INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      'admin', p_actor_id, 'departure.withdrawn', 'tour_instance', v_instance.id,
      jsonb_build_object(
        'schedule_id', v_instance.schedule_id,
        'starts_at', v_instance.starts_at,
        'reason', v_reason
      )
    );
    v_withdrawn := v_withdrawn + 1;
  END LOOP;

  RETURN jsonb_build_object('withdrawn', v_withdrawn, 'kept', v_kept);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.withdraw_schedule_instances(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_schedule_instances(uuid, uuid) TO service_role;
