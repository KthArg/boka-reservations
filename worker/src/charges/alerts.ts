import * as Sentry from '@sentry/node';

// Mensajes de alerta de los jobs del cobro diferido (spec 0029), como constantes para dejar los
// call-sites en una línea. Una issue por fingerprint, no un evento por reserva ni por ciclo.
export const MSG_STUCK_PROCESSING =
  '[watch-charges] cobro en processing hace más de 24 h: revisión manual';
export const MSG_UNEXPECTED_INTENT = '[charges] intent en estado inesperado: revisión manual';
export const MSG_INTENT_NOT_FOUND =
  '[charges] intent inexistente en OnvoPay (404): revisar la llave o el entorno';
export const MSG_CANCEL_INTENT_FAILED =
  '[charges] no se pudo cancelar el intent en OnvoPay; lo reintenta close-payment-intents';
export const MSG_IN_FLIGHT_WITHOUT_PAYMENT =
  '[watch-charges] cobro en vuelo sin pago pending: revisión manual';
export const MSG_UNVERIFIABLE = '[charges] cobro liquidado sin monto en el GET: revisión manual';
export const MSG_MISMATCH = '[charges] cobro con monto/moneda no coincidente';
export const MSG_UNCLAIMED = '[charges] reserva diferida confirmada sin cobro iniciado';
export const MSG_OVERBOOKED = '[charges] cobro liquidado sin cupo: reserva auto-reembolsada';
export const MSG_LATE_REFUNDED =
  '[charges] cobro tardío sobre reserva cancelada: refund total encolado';
export const MSG_IGNORED = '[charges] cobro liquidado en estado no accionable: revisión manual';
export const MSG_UNKNOWN_OUTCOME =
  '[charges] outcome desconocido de confirm_booking: revisión manual';
export const MSG_MANUAL_REFUND =
  '[charges] cobro que requiere reembolso manual (doble cobro o refund bloqueado)';
export const MSG_PENDING_ON_CANCELLED =
  '[close-payment-intents] pago pending sobre una reserva cancelada';
export const MSG_SETTLED_ELSEWHERE =
  '[close-payment-intents] intent liquidado con el evento ya consumido y la fila sin asentar';
export const MSG_UNCLOSED_PAST_WINDOW =
  '[close-payment-intents] intents sin cerrar tras 7 días: verificar en OnvoPay y registrar el cierre';

// Misma alerta por reserva que el reconciliador: un solo lugar decide scope, nivel y fingerprint.
export { alert as alertCharge, type AlertLevel } from '../reconciliation/alerts.js';

/** Alerta agregada de nivel error para un conjunto (no una reserva): acción manual del staff. */
export function alertCount(message: string, fingerprint: string, count: number): void {
  Sentry.withScope((scope) => {
    scope.setLevel('error');
    scope.setFingerprint([fingerprint]);
    scope.setExtra('count', count);
    Sentry.captureMessage(message);
  });
}
