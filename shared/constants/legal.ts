/**
 * Constantes legales (spec 0021, P1-3).
 *
 * Versión vigente del aviso de privacidad / términos que el turista acepta en el checkout.
 * Se estampa server-side en `bookings.consent_version` al consentir, como evidencia de QUÉ
 * texto aceptó cada turista. Incrementar este valor cada vez que el cliente cambie el texto
 * legal (de /privacy o /terms), para que las reservas nuevas registren la versión nueva sin
 * afectar las previas.
 */
export const PRIVACY_NOTICE_VERSION = '2026-06-13';
