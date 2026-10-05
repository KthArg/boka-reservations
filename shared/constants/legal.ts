/**
 * Constantes legales (specs 0021, 0031 y 0034).
 *
 * Versiones vigentes de los textos que el turista acepta en el checkout. Se estampan
 * server-side en la reserva como evidencia de QUÉ texto aceptó cada turista: la del aviso de
 * privacidad en `bookings.consent_version` y la de los términos en `bookings.terms_version`.
 * Cada una se sube por separado, a la fecha de publicación, cuando cambie su texto (/privacy o
 * /terms), para que las reservas nuevas registren la versión nueva sin afectar las previas.
 * Formato `YYYY-MM-DD`, sin sufijos. Cada valor tiene que existir en el registro de textos
 * publicados (`web/content/legal/registry.ts`, spec 0034): un test lo verifica.
 */
export const PRIVACY_NOTICE_VERSION = '2026-10-05';

export const TERMS_VERSION = '2026-10-05';

/**
 * Nombres de las casillas legales del checkout y su valor marcado (spec 0031). Son el contrato
 * entre el formulario, la validación del servidor y el paso 2 del flujo diferido, que rearma el
 * formulario: un nombre distinto en cualquiera de los tres haría fallar todos los checkouts.
 */
export const CheckoutLegalField = {
  Terms: 'terms',
  PrivacyConsent: 'privacy_consent',
} as const;

export const CHECKOUT_ACCEPTED_VALUE = 'accepted';
