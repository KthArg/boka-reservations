-- Migración …051 — Cierres operativos de lanzamiento (spec 0038).
--
--   1. Una cuenta borrada en Supabase Auth ya no deja su fila en public.users: el trigger
--      on_auth_user_deleted la borra, o, si la persona tiene historial (FK NO ACTION), la deja
--      inactiva y libera su correo con un sustituto (<id>@cuenta-borrada.invalid).
--   2. anonymize_booking_pii_by_email devuelve también retained_count (las reservas vivas que no
--      se tocaron), para que el panel se lo diga al admin. Cambia el tipo de retorno: DROP + CREATE.
--
-- Supuestos del trigger: ninguna FK hacia public.users es DEFERRABLE (si lo fuera, la violación
-- saltaría al final de la transacción, fuera del bloque que la atrapa, y revertiría el borrado en
-- Auth). El bloque EXCEPTION abre una subtransacción que revierte solo el DELETE. A una función de
-- trigger no se le controla EXECUTE al dispararse: corre aunque GoTrue borre como
-- supabase_auth_admin.
--
-- Hardening (patrón …044): SECURITY DEFINER + search_path = '' + REVOKE de PUBLIC, anon,
-- authenticated; GRANT explícito a service_role (…039: en producción no se hereda).
--
-- Reversión: DROP TRIGGER on_auth_user_deleted ON auth.users; DROP FUNCTION
-- public.handle_auth_user_deleted(); DROP FUNCTION public.anonymize_booking_pii_by_email(text,
-- uuid) y recrearla como en …050 (sin retained_count), con su REVOKE y el GRANT a service_role.

SET LOCAL lock_timeout = '5s';

-- ================================================================
-- 1. Cuentas borradas en Supabase Auth
-- ================================================================

CREATE FUNCTION public.handle_auth_user_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    DELETE FROM public.users WHERE id = OLD.id;
  EXCEPTION WHEN foreign_key_violation THEN
    -- Tiene historial (reservas marcadas, asignaciones, auditoría, decisiones): la fila queda
    -- inactiva y el correo se libera para poder invitar de nuevo a la persona.
    UPDATE public.users
       SET active = false,
           email = OLD.id::text || '@cuenta-borrada.invalid'
     WHERE id = OLD.id;
  END;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_auth_user_deleted() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_deleted();

-- ================================================================
-- 2. Borrado por correo: cuántas reservas quedaron retenidas
-- ================================================================

DROP FUNCTION public.anonymize_booking_pii_by_email(text, uuid);

CREATE FUNCTION public.anonymize_booking_pii_by_email(
  p_email    text,
  p_actor_id uuid
)
RETURNS TABLE(anonymized_count integer, deleted_count integer, retained_count integer)
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

  -- Con dinero pendiente de devolver no se borra nada: la persona perdería el aviso. La acción del
  -- panel ya lo verifica; esto es la segunda capa.
  IF EXISTS (
    SELECT 1 FROM public.refunds r
    JOIN public.bookings b ON b.id = r.booking_id
    WHERE lower(b.customer_email) = v_email
      AND r.status IN ('pending', 'processing', 'failed', 'awaiting_transfer')
  ) THEN
    RAISE EXCEPTION 'PENDING_REFUND';
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

  RETURN QUERY SELECT v_anon, v_del, v_retained;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.anonymize_booking_pii_by_email(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_booking_pii_by_email(text, uuid) TO service_role;
