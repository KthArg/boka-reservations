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
-- refunds_no_processing_fee_check; REVOKE UPDATE de las columnas nuevas de business_settings a
-- authenticated; DROP de las columnas nuevas.

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
-- cambiar la firma de la función ni depender de que el llamador lo pase.
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
