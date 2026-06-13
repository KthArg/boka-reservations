-- Migration: retención de datos y anonimización de PII (Ley 8968).
-- Spec: 0022-retencion-y-anonimizacion-pii
--
-- Cierra los hallazgos PRIV-02 (operación de anonimización por titular para el
-- derecho de eliminación) y PRIV-03 (retención automática) de la re-auditoría del
-- Security Council (docs/security-audits/2026-06-13-reauditoria-1.md).
--
-- Principio: ANONIMIZAR cuando la reserva tiene rastro financiero (pago succeeded/
-- refunded) — se conserva el registro contable; BORRAR cuando no lo tiene (abandono).
-- Las reservas en payment_mismatch se conservan en la retención automática (anomalía a
-- investigar) y se anonimizan en la operación on-request (se honra el derecho de
-- eliminación sin perder la anomalía, ya que no se puede borrar).
--
-- FKs: payments y refunds NO cascadean desde bookings; por eso el borrado físico
-- elimina en orden refunds -> payments -> bookings (notifications y *_access_tokens
-- sí cascadean). No se alteran las FKs existentes (cambio acotado a estas funciones).
--
-- Hardening (espejo de las funciones de dinero, migración …029): SECURITY DEFINER +
-- search_path = '' (todas las referencias calificadas como public.*) + guard
-- is_public_request() + REVOKE EXECUTE de PUBLIC, anon, authenticated. Solo service_role
-- las ejecuta (la app y el worker las llaman así).
--
-- Reversibilidad: forward-only. Para revertir: DROP de las funciones y de la columna.

-- ----------------------------------------------------------------
-- Marca de anonimización. NULL = no anonimizada. Da idempotencia (las funciones
-- omiten reservas ya anonimizadas) y trazabilidad. No es estado de negocio.
-- ----------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN anonymized_at timestamptz;

-- ----------------------------------------------------------------
-- PRIV-02: anonimización por titular (on-request). La dispara una server action
-- admin-only con el service client. Anonimiza las reservas con rastro financiero o en
-- payment_mismatch; borra las abandonadas (sin rastro y no mismatch). Idempotente.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymize_booking_pii_by_email(
  p_email    text,
  p_actor_id uuid
)
RETURNS TABLE(anonymized_count integer, deleted_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_anon  integer := 0;
  v_del   integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  -- 1) Anonimizar (rastro financiero o payment_mismatch). Primero las notificaciones,
  --    mientras el email original aún matchea; luego la reserva.
  UPDATE public.notifications n
    SET recipient_email = 'anonimizado@anonimizado.local'
    FROM public.bookings b
    WHERE n.booking_id = b.id
      AND lower(b.customer_email) = v_email
      AND b.anonymized_at IS NULL
      AND (
        b.status = 'payment_mismatch'
        OR EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
        )
      );

  UPDATE public.bookings b
    SET customer_name  = 'ANONIMIZADO',
        customer_email = 'anonimizado@anonimizado.local',
        anonymized_at  = now()
    WHERE lower(b.customer_email) = v_email
      AND b.anonymized_at IS NULL
      AND (
        b.status = 'payment_mismatch'
        OR EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
        )
      );
  GET DIAGNOSTICS v_anon = ROW_COUNT;

  -- 2) Borrar las abandonadas (sin rastro financiero, no payment_mismatch).
  DELETE FROM public.refunds r
    USING public.bookings b
    WHERE r.booking_id = b.id
      AND lower(b.customer_email) = v_email
      AND b.status <> 'payment_mismatch'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );

  DELETE FROM public.payments p
    USING public.bookings b
    WHERE p.booking_id = b.id
      AND lower(b.customer_email) = v_email
      AND b.status <> 'payment_mismatch'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p2
        WHERE p2.booking_id = b.id AND p2.status IN ('succeeded', 'refunded')
      );

  DELETE FROM public.bookings b
    WHERE lower(b.customer_email) = v_email
      AND b.status <> 'payment_mismatch'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );
  GET DIAGNOSTICS v_del = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    'admin', p_actor_id, 'privacy.anonymized_by_email', 'privacy_erasure', gen_random_uuid(),
    jsonb_build_object('anonymized_count', v_anon, 'deleted_count', v_del)
  );

  RETURN QUERY SELECT v_anon, v_del;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anonymize_booking_pii_by_email(text, uuid)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- PRIV-03: retención automática. Cuatro funciones que el job apply-retention del worker
-- invoca a diario con los cutoffs derivados de las constantes de retención (perfil B).
-- ----------------------------------------------------------------

-- Anonimiza PII de reservas con rastro financiero cuya salida ya pasó la ventana de PII.
CREATE OR REPLACE FUNCTION public.anonymize_bookings_past_retention(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  UPDATE public.notifications n
    SET recipient_email = 'anonimizado@anonimizado.local'
    FROM public.bookings b
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    WHERE n.booking_id = b.id
      AND ti.starts_at < p_cutoff
      AND b.anonymized_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );

  UPDATE public.bookings b
    SET customer_name  = 'ANONIMIZADO',
        customer_email = 'anonimizado@anonimizado.local',
        anonymized_at  = now()
    FROM public.tour_instances ti
    WHERE ti.id = b.tour_instance_id
      AND ti.starts_at < p_cutoff
      AND b.anonymized_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'retention.anonymized', 'retention_run', gen_random_uuid(),
    jsonb_build_object('affected_count', v_count, 'cutoff', p_cutoff)
  );

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anonymize_bookings_past_retention(timestamptz)
  FROM PUBLIC, anon, authenticated;

-- Borra reservas sin rastro financiero (abandonadas) anteriores al cutoff. Conserva
-- payment_mismatch (anomalía). Borra dependientes en orden refunds -> payments -> bookings.
CREATE OR REPLACE FUNCTION public.purge_unpaid_bookings(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  DELETE FROM public.refunds r
    USING public.bookings b
    WHERE r.booking_id = b.id
      AND b.created_at < p_cutoff
      AND b.status <> 'payment_mismatch'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );

  DELETE FROM public.payments p
    USING public.bookings b
    WHERE p.booking_id = b.id
      AND b.created_at < p_cutoff
      AND b.status <> 'payment_mismatch'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p2
        WHERE p2.booking_id = b.id AND p2.status IN ('succeeded', 'refunded')
      );

  DELETE FROM public.bookings b
    WHERE b.created_at < p_cutoff
      AND b.status <> 'payment_mismatch'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'retention.purged_unpaid', 'retention_run', gen_random_uuid(),
    jsonb_build_object('affected_count', v_count, 'cutoff', p_cutoff)
  );

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_unpaid_bookings(timestamptz)
  FROM PUBLIC, anon, authenticated;

-- Borra tokens de acceso (booking + guide) vencidos antes del cutoff. Cierre textual
-- de PRIV-03.
CREATE OR REPLACE FUNCTION public.purge_expired_access_tokens(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking integer := 0;
  v_guide   integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  DELETE FROM public.booking_access_tokens WHERE expires_at < p_cutoff;
  GET DIAGNOSTICS v_booking = ROW_COUNT;

  DELETE FROM public.guide_access_tokens WHERE expires_at < p_cutoff;
  GET DIAGNOSTICS v_guide = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'retention.purged_tokens', 'retention_run', gen_random_uuid(),
    jsonb_build_object('booking_tokens', v_booking, 'guide_tokens', v_guide, 'cutoff', p_cutoff)
  );

  RETURN v_booking + v_guide;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_access_tokens(timestamptz)
  FROM PUBLIC, anon, authenticated;

-- Borra notificaciones anteriores al cutoff (logs operacionales de emails ya enviados;
-- contienen el email del destinatario).
CREATE OR REPLACE FUNCTION public.purge_old_notifications(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  DELETE FROM public.notifications WHERE created_at < p_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'retention.purged_notifications', 'retention_run', gen_random_uuid(),
    jsonb_build_object('affected_count', v_count, 'cutoff', p_cutoff)
  );

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_notifications(timestamptz)
  FROM PUBLIC, anon, authenticated;
