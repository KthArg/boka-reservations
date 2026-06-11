/**
 * Límites y ventanas de rate limiting por endpoint sensible (spec 0017, M-3).
 *
 * Valores iniciales conservadores (holgados) a afinar observando los eventos de
 * "rate limit excedido" en Sentry. Aislados de la lógica para poder ajustarlos sin
 * tocar el código que los consume. El kill-switch global vive en la env
 * RATE_LIMIT_ENABLED (ver web/lib/env.ts), no acá.
 *
 * `windowSeconds` en segundos (la función SQL usa make_interval(secs => ...)).
 */

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

export type RateLimitRule = {
  readonly limit: number;
  readonly windowSeconds: number;
};

export const RATE_LIMITS = {
  /** Login por cuenta objetivo (email): frena fuerza bruta contra una cuenta. */
  loginPerEmail: { limit: 5, windowSeconds: 15 * SECONDS_PER_MINUTE },
  /** Login por IP: holgado para no molestar NAT/CGNAT compartido. */
  loginPerIp: { limit: 20, windowSeconds: 15 * SECONDS_PER_MINUTE },
  /** Forgot-password por email destino: evita email bombing a una víctima. */
  forgotPerEmail: { limit: 3, windowSeconds: SECONDS_PER_HOUR },
  /** Forgot-password por IP. */
  forgotPerIp: { limit: 10, windowSeconds: SECONDS_PER_HOUR },
  /** Checkout por IP: acota la frecuencia de holds para no secuestrar cupo. */
  checkoutPerIp: { limit: 10, windowSeconds: 10 * SECONDS_PER_MINUTE },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Prefijos de las claves del store. La clave final es `<prefijo>:<identidad-hasheada>`
 * para no guardar PII en claro (ver web/lib/security/rate-limit-key.ts).
 */
export const RATE_LIMIT_KEY_PREFIX = {
  loginIp: 'login:ip',
  loginEmail: 'login:email',
  forgotIp: 'forgot:ip',
  forgotEmail: 'forgot:email',
  checkoutIp: 'checkout:ip',
} as const;

/** Valor de IP cuando el header x-forwarded-for está ausente (local sin proxy). */
export const UNKNOWN_IP = 'unknown';
