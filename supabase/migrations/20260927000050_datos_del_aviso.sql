-- Migración …050 — Tratamiento de datos según el aviso de privacidad (spec 0036).
--
--   1. Anonimización a los 18 meses completa: además de nombre y correo, los datos de tarjeta y
--      del cliente de OnvoPay, el comprobante de una devolución por transferencia, y las reservas
--      en payment_mismatch (que conservan sus montos, como las pagadas).
--   2. purge_financial_records: a los 5 años borra la reserva y sus pagos, reembolsos y
--      notificaciones, salvo que tenga plata pendiente. audit_logs no se purga (spec 0036 §3).
--   3. custom_access_token_hook niega el token a un usuario desactivado.
--   4. Fotos de los tours en Supabase Storage (bucket público `tour-images`, escritura solo
--      admin) y CHECK de que cover_image_url apunte a ese bucket.
--
-- Hardening (patrón …044): SECURITY DEFINER + search_path = '' + guard is_public_request() +
-- REVOKE de PUBLIC, anon, authenticated.
--
-- Reversión: restaurar las funciones de …034/…044 y el hook de …007; DROP de
-- purge_financial_records, del CHECK y de las políticas de Storage. El bucket se puede dejar.

SET LOCAL lock_timeout = '5s';

-- ================================================================
-- 1. Anonimización
-- ================================================================

-- Una reserva con rastro que se anonimiza en vez de borrarse: pagada, reembolsada o en
-- payment_mismatch (anomalía de monto que el operador tiene que poder conciliar).
CREATE FUNCTION public.booking_has_financial_trace(p_booking public.bookings)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p_booking.status = 'payment_mismatch'
    OR EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.booking_id = p_booking.id AND p.status IN ('succeeded', 'refunded')
    );
$$;
REVOKE EXECUTE ON FUNCTION public.booking_has_financial_trace(public.bookings)
  FROM PUBLIC, anon, authenticated, service_role;

-- Vacía todo lo que vincula la reserva a la persona. Las notificaciones primero, mientras el
-- correo original todavía identifica la reserva.
CREATE FUNCTION public.anonymize_booking_row(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.notifications
    SET recipient_email = 'anonimizado@anonimizado.local'
    WHERE booking_id = p_booking_id;

  UPDATE public.refunds
    SET transfer_reference = CASE WHEN transfer_reference IS NULL THEN NULL ELSE 'ANONIMIZADO' END
    WHERE booking_id = p_booking_id;

  UPDATE public.bookings
    SET customer_name        = 'ANONIMIZADO',
        customer_email       = 'anonimizado@anonimizado.local',
        card_brand           = NULL,
        card_last4           = NULL,
        card_exp_month       = NULL,
        card_exp_year        = NULL,
        customer_external_id = NULL,
        payment_method_id    = NULL,
        anonymized_at        = now()
    WHERE id = p_booking_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.anonymize_booking_row(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anonymize_bookings_past_retention(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
  v_count   integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  FOR v_booking IN
    SELECT b.* FROM public.bookings b
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    WHERE ti.starts_at < p_cutoff
      AND b.anonymized_at IS NULL
      -- Sin la exclusión de booking_retention_locked: 18 meses después del tour no queda ningún
      -- flujo vivo que proteger, y un pago `pending` huérfano retendría los datos para siempre.
      AND public.booking_has_financial_trace(b)
  LOOP
    PERFORM public.anonymize_booking_row(v_booking.id);
    v_count := v_count + 1;
  END LOOP;

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
  v_email    text := lower(trim(p_email));
  v_booking  public.bookings;
  v_anon     integer := 0;
  v_del      integer := 0;
  v_retained integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  -- 1) Con rastro financiero: se anonimizan (el registro de la venta se conserva 5 años).
  FOR v_booking IN
    SELECT b.* FROM public.bookings b
    WHERE lower(b.customer_email) = v_email
      AND b.anonymized_at IS NULL
      AND public.booking_has_financial_trace(b)
  LOOP
    PERFORM public.anonymize_booking_row(v_booking.id);
    v_anon := v_anon + 1;
  END LOOP;

  -- (spec 0029) Reservas vivas o con un intent potencialmente abierto: no se borran.
  SELECT count(*) INTO v_retained
    FROM public.bookings b
    WHERE lower(b.customer_email) = v_email
      AND NOT public.booking_has_financial_trace(b)
      AND public.booking_retention_locked(b);

  -- 2) Sin rastro financiero y no retenidas: se borran con lo que depende de ellas.
  DELETE FROM public.notifications n
    USING public.bookings b
    WHERE n.booking_id = b.id
      AND lower(b.customer_email) = v_email
      AND NOT public.booking_has_financial_trace(b)
      AND NOT public.booking_retention_locked(b);

  DELETE FROM public.refunds r
    USING public.bookings b
    WHERE r.booking_id = b.id
      AND lower(b.customer_email) = v_email
      AND NOT public.booking_has_financial_trace(b)
      AND NOT public.booking_retention_locked(b);

  DELETE FROM public.payments p
    USING public.bookings b
    WHERE p.booking_id = b.id
      AND lower(b.customer_email) = v_email
      AND NOT public.booking_has_financial_trace(b)
      AND NOT public.booking_retention_locked(b);

  DELETE FROM public.booking_access_tokens t
    USING public.bookings b
    WHERE t.booking_id = b.id
      AND lower(b.customer_email) = v_email
      AND NOT public.booking_has_financial_trace(b)
      AND NOT public.booking_retention_locked(b);

  DELETE FROM public.bookings b
    WHERE lower(b.customer_email) = v_email
      AND NOT public.booking_has_financial_trace(b)
      AND NOT public.booking_retention_locked(b);
  GET DIAGNOSTICS v_del = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    'admin', p_actor_id, 'privacy.anonymized_by_email', 'privacy_erasure', gen_random_uuid(),
    jsonb_build_object(
      'anonymized_count', v_anon,
      'deleted_count', v_del,
      'retained_count', v_retained
    )
  );

  RETURN QUERY SELECT v_anon, v_del;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.anonymize_booking_pii_by_email(text, uuid)
  FROM PUBLIC, anon, authenticated;

-- ================================================================
-- 2. Purga del registro de la venta a los 5 años
-- ================================================================
CREATE FUNCTION public.purge_financial_records(p_cutoff timestamptz)
RETURNS TABLE(bookings_count integer, payments_count integer, refunds_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bookings integer := 0;
  v_payments integer := 0;
  v_refunds  integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  -- Candidatas: salida terminada antes del corte, ya anonimizada y sin plata pendiente.
  CREATE TEMP TABLE purge_candidates ON COMMIT DROP AS
    SELECT b.id
    FROM public.bookings b
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    WHERE ti.ends_at < p_cutoff
      AND b.anonymized_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.refunds r
        WHERE r.booking_id = b.id
          AND r.status IN ('pending', 'processing', 'failed', 'awaiting_transfer')
      );

  DELETE FROM public.notifications WHERE booking_id IN (SELECT id FROM purge_candidates);
  DELETE FROM public.booking_access_tokens WHERE booking_id IN (SELECT id FROM purge_candidates);
  DELETE FROM public.refunds WHERE booking_id IN (SELECT id FROM purge_candidates);
  GET DIAGNOSTICS v_refunds = ROW_COUNT;
  DELETE FROM public.payments WHERE booking_id IN (SELECT id FROM purge_candidates);
  GET DIAGNOSTICS v_payments = ROW_COUNT;
  DELETE FROM public.bookings WHERE id IN (SELECT id FROM purge_candidates);
  GET DIAGNOSTICS v_bookings = ROW_COUNT;

  DROP TABLE purge_candidates;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'retention.purged_financial', 'retention_run', gen_random_uuid(),
    jsonb_build_object(
      'bookings_count', v_bookings,
      'payments_count', v_payments,
      'refunds_count', v_refunds,
      'cutoff', p_cutoff
    )
  );

  RETURN QUERY SELECT v_bookings, v_payments, v_refunds;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_financial_records(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_financial_records(timestamptz) TO service_role;

-- ================================================================
-- 3. Hook del token: un usuario desactivado no obtiene token nuevo
-- ================================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims     jsonb;
  role_value text;
  is_active  boolean;
BEGIN
  BEGIN
    SELECT role::text, active INTO role_value, is_active
    FROM public.users
    WHERE id = (event->>'user_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    role_value := NULL;
    is_active := NULL;
  END;

  -- Spec 0036: desactivar a alguien corta su acceso. Sin token nuevo, la sesión termina en la
  -- próxima renovación.
  IF is_active IS FALSE THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object('http_code', 403, 'message', 'Usuario desactivado')
    );
  END IF;

  claims := event->'claims';

  IF role_value IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(role_value));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- ================================================================
-- 4. Fotos de los tours en el almacenamiento propio
-- ================================================================

-- Público de lectura: la página del tour la muestra sin sesión. 5 MB, solo imágenes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tour-images', 'tour-images', true, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY tour_images_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tour-images' AND (auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY tour_images_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'tour-images' AND (auth.jwt() ->> 'user_role') = 'admin')
  WITH CHECK (bucket_id = 'tour-images' AND (auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY tour_images_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'tour-images' AND (auth.jwt() ->> 'user_role') = 'admin');

-- Una URL que no es del bucket haría que la página del tour le entregue la IP del visitante a
-- un tercero. El dominio varía entre entornos; el camino del bucket no.
ALTER TABLE public.tours ADD CONSTRAINT tours_cover_image_url_check
  CHECK (
    cover_image_url IS NULL
    OR cover_image_url ~ '^https?://[^/]+/storage/v1/object/public/tour-images/[^?#]+$'
  );
