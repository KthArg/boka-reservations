import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnvopayChargeClient } from './onvopay.js';
import type { UnpaidCandidate } from './in-flight-repository.js';
import {
  decideUnpaidCancel,
  IntentStatus,
  intentStatusOf,
  isConfirmable,
  UnpaidCancelAction,
} from './decide.js';
import {
  CancelUnpaidOutcome,
  cancelChargeInFlight,
  cancelUnpaidBooking,
  type CancelUnpaidReasonValue,
} from './rpc.js';
import { settleSucceeded } from './settle.js';
import { cancelIntentBestEffort } from './cancel-intent.js';
import { unreachable } from './exhaustive.js';
import { alertCharge, MSG_INTENT_NOT_FOUND, MSG_UNEXPECTED_INTENT } from './alerts.js';

const SOURCE = 'watch-charges';

/**
 * Cancela UNA reserva sin cobrar cuyo plazo de recuperación venció o cuya salida empezó (§5.7,
 * §5.9). Si conserva un intent (un rechazo registrado deja su fila `pending` para reintentar),
 * primero el GET (§5.5): pudo haber liquidado con el webhook perdido, y cancelarla a ciegas le
 * quitaría la reserva a un turista que pagó. Sin cliente de OnvoPay esa reserva espera.
 */
export async function cancelUnpaidOne(
  db: SupabaseClient,
  client: OnvopayChargeClient | null,
  candidate: UnpaidCandidate,
  reason: CancelUnpaidReasonValue,
): Promise<void> {
  const payment = candidate.payments[0];
  if (!payment) {
    await cancelAndReport(db, candidate, reason);
    return;
  }
  if (!client) return;

  const intent = await client.getIntent(payment.external_payment_id);
  const status = intentStatusOf(intent);
  const action = decideUnpaidCancel(status);

  switch (action) {
    case UnpaidCancelAction.Settle:
      if (intent) await settleSucceeded(db, candidate.id, payment, intent, SOURCE);
      return;
    case UnpaidCancelAction.Wait:
      return;
    case UnpaidCancelAction.AlertUnexpected:
      alertCharge(MSG_UNEXPECTED_INTENT, `${SOURCE}-unexpected-intent`, candidate.id, 'error');
      return;
    case UnpaidCancelAction.Cancel:
      if (status === IntentStatus.NotFound) {
        alertCharge(MSG_INTENT_NOT_FOUND, `${SOURCE}-intent-not-found`, candidate.id, 'error');
      }
      if ((await cancelAndReport(db, candidate, reason)) && isConfirmable(status)) {
        await cancelIntentBestEffort(client, candidate.id, payment.external_payment_id, SOURCE);
      }
      return;
    default:
      unreachable(action);
  }
}

async function cancelAndReport(
  db: SupabaseClient,
  candidate: UnpaidCandidate,
  reason: CancelUnpaidReasonValue,
): Promise<boolean> {
  // Una reserva autorizada (spec 0033) ya no es `pending_minimum`, que es lo único que acepta
  // cancel_unpaid_booking: la cancela la función del cobro en vuelo, que además limpia las marcas
  // de la autorización. Las dos razones que usa este job son válidas para ambas.
  if (candidate.authorized_at !== null) {
    const cancelled = await cancelChargeInFlight(db, candidate.id, reason);
    if (!cancelled) {
      console.warn(`[${SOURCE}] autorización no cancelada (${reason})`, candidate.id);
    }
    return cancelled;
  }

  const outcome = await cancelUnpaidBooking(db, candidate.id, reason);
  if (outcome === CancelUnpaidOutcome.Cancelled) return true;
  // Entre la consulta y el lock otro actor la resolvió o empezó a cobrarla: el ciclo siguiente
  // vuelve a decidir con el estado nuevo.
  console.warn(`[${SOURCE}] reserva no cancelada (${reason}): ${outcome}`, candidate.id);
  return false;
}
