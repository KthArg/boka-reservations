import 'server-only';
import { captureAlert } from './sentry-alert';

// Alertas del cobro manual (spec 0029 §5.6, §5.11). Todo camino que termina en "revisión manual"
// alerta: el mensaje que ve el staff lo promete. Solo ids de reserva e intent.

/** Motivos de revisión manual; cada uno es su propia issue en Sentry. */
export const ManualChargeReview = {
  UnexpectedIntent: 'unexpected-intent',
  IntentMismatch: 'intent-mismatch',
  SettledWithoutAmount: 'settled-without-amount',
  Mismatch: 'mismatch',
  SettledNotConfirmed: 'settled-not-confirmed',
  RegistrationSkipped: 'registration-skipped',
  CloseSkipped: 'close-skipped',
  StartUnknown: 'start-unknown',
} as const;

export type ManualChargeReviewValue = (typeof ManualChargeReview)[keyof typeof ManualChargeReview];

function ids(bookingId: string, intentId?: string): Record<string, string> {
  return intentId ? { bookingId, intentId } : { bookingId };
}

export function alertManualChargeReview(
  reason: ManualChargeReviewValue,
  bookingId: string,
  intentId?: string,
): void {
  captureAlert(
    `[manual-charge] cobro que requiere revisión manual: ${reason}`,
    `manual-charge-${reason}`,
    ids(bookingId, intentId),
    'error',
  );
}

/** Intent creado sin su fila que no se pudo cancelar (§5.6): hay que cancelarlo en OnvoPay. */
export function alertIntentNotCancelled(bookingId: string, intentId: string): void {
  captureAlert(
    '[manual-charge] intent creado sin su fila que no se pudo cancelar: cancelarlo en OnvoPay',
    'manual-charge-intent-not-cancelled',
    ids(bookingId, intentId),
    'error',
  );
}

/** createPaymentSession falló: un timeout pudo haber creado un intent sin devolver su id. */
export function alertIntentCreationFailed(bookingId: string): void {
  captureAlert(
    '[manual-charge] crear el intent falló: puede haber un intent sin registrar en OnvoPay',
    'manual-charge-intent-creation-failed',
    ids(bookingId),
  );
}

/** Confirm sin respuesta: el cobro queda en vuelo hasta que watch-charges lo resuelva. */
export function alertConfirmUnanswered(bookingId: string, intentId: string): void {
  captureAlert(
    '[manual-charge] confirm sin respuesta: lo resuelve watch-charges',
    'manual-charge-confirm-unanswered',
    ids(bookingId, intentId),
  );
}

/**
 * Una reserva sin cobro en vuelo cuyo intent está en processing o requires_action: alguien lo
 * confirmó por fuera (§5.1, publishable key).
 */
export function alertRetainedIntentActive(
  bookingId: string,
  intentId: string,
  status: string,
): void {
  captureAlert(
    '[manual-charge] intent retenido activo sin cobro en vuelo',
    'manual-charge-retained-intent-active',
    { ...ids(bookingId, intentId), status },
  );
}
