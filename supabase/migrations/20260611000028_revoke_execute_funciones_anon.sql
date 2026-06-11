-- Migration: cerrar la ejecución de funciones privilegiadas por anon/authenticated
-- Hallazgo de seguridad (2da auditoría, 2026-06-11) — CRÍTICO.
--
-- PROBLEMA: todas las funciones SECURITY DEFINER del proyecto se blindaron con
-- `REVOKE EXECUTE ... FROM PUBLIC`. En Supabase eso NO alcanza: los roles `anon` y
-- `authenticated` reciben un GRANT EXECUTE propio por los DEFAULT PRIVILEGES del
-- esquema public, y revocar de PUBLIC no toca ese grant. Resultado: cualquiera con
-- la anon key (que viaja al browser) podía invocar estas RPC directamente contra
-- PostgREST (`POST /rest/v1/rpc/<fn>`), saltándose por completo la capa de aplicación.
--
-- Verificado en vivo: como `anon`, `confirm_booking`/`cancel_booking`/`create_hold_atomic`/
-- `settle_refund`/`flag_payment_mismatch`/`cancel_stale_pending_booking` ejecutaban su
-- cuerpo (devolvían sus errores internos P0001), y `check_rate_limit` hacía un INSERT
-- privilegiado en `rate_limits` (tabla en la que anon no puede insertar directo). Impacto:
--   - confirm_booking -> confirmar una reserva sin pagar (bypass de pago).
--   - cancel_booking  -> reembolso de monto ARBITRARIO (p_refund_amount_cents no capeado)
--                        y bypass de la política de 24h.
--   - create_hold_atomic -> agotar cupo saltándose el rate-limit del checkout (DoS).
--   - check_rate_limit -> lockout dirigido (la clave es sha256(email) sin secreto).
--
-- La única función que ya estaba bien cerrada era custom_access_token_hook, porque su
-- migración (0007) hizo `REVOKE EXECUTE ... FROM authenticated, anon, public`. Este es
-- el patrón correcto y el que se aplica acá al resto.
--
-- POR QUÉ NO ROMPE LA APP: todas estas funciones se llaman desde el código con el
-- service-role client (webhook, lib/booking/create.ts, lib/booking/cancel.ts,
-- lib/security/rate-limit.ts, y los jobs del worker). `service_role` tiene su propio
-- grant y NO se ve afectado por revocar de anon/authenticated. Las report_* son
-- SECURITY INVOKER y las invoca el panel con sesión AUTHENTICATED, así que a esas solo
-- se les revoca anon (authenticated conserva su GRANT explícito de 20260606000022).
--
-- Reversibilidad: forward-only. Revertir = re-GRANT EXECUTE a esos roles (no recomendado).

-- ----------------------------------------------------------------
-- 1. create_hold_atomic: además del REVOKE, fijar search_path = '' (era la única
--    función SECURITY DEFINER que no lo tenía; el endurecimiento del Checkpoint 6
--    del 0011 fijó confirm_booking/cancel_booking pero salteó esta). El cuerpo es
--    idéntico al de 20260526000011: ya califica todo con public., así que el
--    search_path vacío es seguro. CREATE OR REPLACE preserva el ACL existente, por
--    eso el REVOKE de abajo igual hace falta.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_hold_atomic(
  p_instance_id  uuid,
  p_seats        integer,
  p_session      text
)
RETURNS public.tour_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance   public.tour_instances;
  v_held       integer;
  v_available  integer;
  v_hold       public.tour_holds;
BEGIN
  -- Bloquear la fila de la instancia para serializar requests concurrentes
  SELECT * INTO v_instance
    FROM public.tour_instances
    WHERE id = p_instance_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOLD_INSTANCE_NOT_FOUND';
  END IF;

  IF v_instance.status <> 'available' THEN
    RAISE EXCEPTION 'HOLD_INSTANCE_UNAVAILABLE';
  END IF;

  IF v_instance.starts_at <= NOW() THEN
    RAISE EXCEPTION 'HOLD_INSTANCE_PAST';
  END IF;

  -- Si ya existe un hold activo para este session_token + instancia, devolverlo
  SELECT * INTO v_hold
    FROM public.tour_holds
    WHERE tour_instance_id = p_instance_id
      AND session_token    = p_session
      AND status           = 'active'
      AND expires_at       > NOW();

  IF FOUND THEN
    RETURN v_hold;
  END IF;

  -- Calcular cupos ocupados por holds activos no expirados
  SELECT COALESCE(SUM(held_seats), 0) INTO v_held
    FROM public.tour_holds
    WHERE tour_instance_id = p_instance_id
      AND status           = 'active'
      AND expires_at       > NOW();

  v_available := v_instance.capacity_total - v_instance.capacity_reserved - v_held;

  IF v_available < p_seats THEN
    RAISE EXCEPTION 'HOLD_NO_CAPACITY';
  END IF;

  -- Crear el hold
  INSERT INTO public.tour_holds (tour_instance_id, session_token, held_seats)
    VALUES (p_instance_id, p_session, p_seats)
    RETURNING * INTO v_hold;

  RETURN v_hold;
END;
$$;

-- ----------------------------------------------------------------
-- 2. Revocar EXECUTE de anon y authenticated en las funciones SECURITY DEFINER que
--    mutan estado. La app las llama con service_role, no con la sesión del usuario.
-- ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_hold_atomic(uuid, integer, text)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer, text)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_booking(uuid, text, integer, uuid)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_refund(uuid)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.flag_payment_mismatch(uuid, integer, text, text)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_stale_pending_booking(uuid, text)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer)
  FROM anon, authenticated;

-- ----------------------------------------------------------------
-- 3. Las report_* son SECURITY INVOKER y las llama el panel con sesión authenticated
--    (RLS aplica como defensa). Solo se revoca anon, por higiene/least-privilege; el
--    GRANT a authenticated de 20260606000022 se conserva.
-- ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.report_revenue(timestamptz, timestamptz)         FROM anon;
REVOKE EXECUTE ON FUNCTION public.report_occupancy(timestamptz, timestamptz)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.report_refunds_summary(timestamptz, timestamptz) FROM anon;
