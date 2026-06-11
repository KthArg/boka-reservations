-- Migration: tabla rate_limits + función check_rate_limit (spec 0017, hallazgo M-3)
--
-- Store del rate limiting a nivel de aplicación. Vive en Postgres (Opción A del spec):
-- estado compartido entre lambdas serverless sin introducir un proveedor nuevo. La
-- función hace el chequeo+incremento de forma ATÓMICA en una sola sentencia
-- (INSERT ... ON CONFLICT DO UPDATE toma el row lock), así dos requests concurrentes que
-- ven la ventana vencida no resetean ambas a count=1 (misma carrera y mismo rigor que
-- create_hold_atomic / confirm_booking).
--
-- Limpieza: un job del worker (cleanup-rate-limits) purga filas con ventana vencida.
-- Forward-only; revertir = DROP FUNCTION + DROP TABLE.

-- ----------------------------------------------------------------
-- Tabla rate_limits
-- ----------------------------------------------------------------
CREATE TABLE public.rate_limits (
  key          text        NOT NULL PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        integer     NOT NULL DEFAULT 0
);

-- Índice para la purga del job de limpieza (DELETE ... WHERE window_start < umbral).
CREATE INDEX rate_limits_window_start_idx ON public.rate_limits (window_start);

-- RLS habilitada SIN políticas: solo service_role (que la bypassea) y la función
-- SECURITY DEFINER acceden. anon/authenticated no leen ni escriben este store.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- Función atómica de chequeo + incremento con ventana fija
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
RETURNS TABLE (allowed boolean, retry_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count        integer;
  v_window_start timestamptz;
BEGIN
  -- Una sola sentencia: el ON CONFLICT DO UPDATE serializa el "resetear si venció vs
  -- incrementar" bajo el row lock del PK. El CASE lee rl.* = fila existente (pre-update);
  -- count y window_start se resetean juntos y de forma consistente.
  INSERT INTO public.rate_limits AS rl (key, window_start, count)
    VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
          WHEN rl.window_start < now() - make_interval(secs => p_window_seconds)
          THEN 1
          ELSE rl.count + 1
        END,
        window_start = CASE
          WHEN rl.window_start < now() - make_interval(secs => p_window_seconds)
          THEN now()
          ELSE rl.window_start
        END
  RETURNING rl.count, rl.window_start INTO v_count, v_window_start;

  IF v_count > p_limit THEN
    allowed := false;
    retry_after := ceil(
      extract(epoch FROM (v_window_start + make_interval(secs => p_window_seconds) - now()))
    )::integer;
    IF retry_after < 0 THEN
      retry_after := 0;
    END IF;
  ELSE
    allowed := true;
    retry_after := 0;
  END IF;

  RETURN NEXT;
END;
$$;

-- Solo service_role (que la llama desde el server) puede ejecutar la función.
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC;
