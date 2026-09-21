import 'server-only';
import * as Sentry from '@sentry/nextjs';

export type AlertLevel = 'warning' | 'error';

/**
 * Alerta a Sentry agrupada por fingerprint (una issue, no un evento por reserva), con ids como
 * extras. Nunca PII: nombres, emails y datos de tarjeta no pasan por acá (PRIV-06, spec 0023).
 */
export function captureAlert(
  message: string,
  fingerprint: string,
  extras: Record<string, string>,
  level: AlertLevel = 'warning',
): void {
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    scope.setFingerprint([fingerprint]);
    for (const [key, value] of Object.entries(extras)) scope.setExtra(key, value);
    Sentry.captureMessage(message);
  });
}
