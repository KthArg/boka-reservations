import * as Sentry from '@sentry/node';

// Mensajes de las alertas a Sentry, como constantes (sin strings mágicos; deja los
// call-sites de alert() en una sola línea). Extraído del job por el límite de 150
// líneas (spec 0028).
export const MSG_UNVERIFIABLE =
  '[reconcile] pago no verificable (sin monto en el GET); revisión manual';
export const MSG_MISMATCH = '[reconcile] pago con monto/moneda no coincidente';
export const MSG_RECOVERED = '[reconcile] reserva recuperada (webhook perdido)';
export const MSG_OVERBOOKED = '[reconcile] recuperada sin cupo';
export const MSG_LATE = '[reconcile] pago tardío sobre reserva cancelada: refund total encolado';
export const MSG_IGNORED = '[reconcile] pago en estado no accionable: revisión manual';
export const MSG_STUCK = '[reconcile] pago estancado en processing >24h (revisión manual)';

// Alerta agregada a Sentry: una sola issue por fingerprint, no un evento por
// reserva ni por ciclo. En dev/CI (sin SENTRY_DSN) es no-op.
export function alert(message: string, fingerprint: string, bookingId: string): void {
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setFingerprint([fingerprint]);
    scope.setExtra('bookingId', bookingId);
    Sentry.captureMessage(message);
  });
}
