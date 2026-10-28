/**
 * Captcha del checkout con Cloudflare Turnstile (spec 0048, Fase B). Contrato entre el widget del
 * navegador y la verificación del servidor: el nombre del campo que deja el widget en el form y la
 * acción que el servidor exige en la respuesta de `siteverify`.
 */
export const CaptchaAction = {
  /** Paso 1 del checkout diferido: el que aparta cupo. */
  DeferredStart: 'deferred_start',
  /** Checkout inmediato con el widget de OnvoPay (no se ofrece con el cobro diferido encendido). */
  Checkout: 'checkout',
} as const;

export type CaptchaActionValue = (typeof CaptchaAction)[keyof typeof CaptchaAction];

/** Input oculto que Turnstile agrega al form con el token (`response-field-name` por defecto). */
export const CAPTCHA_RESPONSE_FIELD = 'cf-turnstile-response';
