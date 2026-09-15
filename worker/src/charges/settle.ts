import type { SupabaseClient } from '@supabase/supabase-js';
import type { IntentSnapshot } from './onvopay.js';
import { ConfirmOutcome, confirmCharge, flagMismatch, type ConfirmOutcomeValue } from './rpc.js';
import {
  alertCharge,
  MSG_IGNORED,
  MSG_LATE_REFUNDED,
  MSG_MANUAL_REFUND,
  MSG_MISMATCH,
  MSG_OVERBOOKED,
  MSG_UNCLAIMED,
  MSG_UNKNOWN_OUTCOME,
  MSG_UNVERIFIABLE,
} from './alerts.js';

export type ExpectedPayment = {
  external_payment_id: string;
  amount_cents: number;
  currency: string;
};

/**
 * Asienta un intent que OnvoPay reporta succeeded (webhook perdido o cobro que liquidó tarde).
 * Nunca a ciegas: sin monto en el GET no se toca nada (null), y un monto o moneda distinto se
 * marca payment_mismatch. Devuelve el outcome para que el caller sume sus propias alertas.
 */
export async function settleSucceeded(
  db: SupabaseClient,
  bookingId: string,
  payment: ExpectedPayment,
  intent: IntentSnapshot,
  source: string,
): Promise<ConfirmOutcomeValue | null> {
  if (intent.amountCents === undefined || intent.currency === undefined) {
    alertCharge(MSG_UNVERIFIABLE, `${source}-unverifiable`, bookingId, 'error');
    return null;
  }

  const currencyMismatch = intent.currency.toUpperCase() !== payment.currency.toUpperCase();
  if (intent.amountCents !== payment.amount_cents || currencyMismatch) {
    await flagMismatch(db, bookingId, intent.amountCents, intent.currency, source);
    alertCharge(MSG_MISMATCH, `${source}-mismatch`, bookingId, 'error');
    return ConfirmOutcome.PaymentMismatch;
  }

  const outcome = await confirmCharge(
    db,
    bookingId,
    payment.external_payment_id,
    intent.amountCents,
    intent.currency,
  );
  alertForOutcome(outcome, bookingId, source);
  return outcome;
}

function alertForOutcome(
  outcome: ConfirmOutcomeValue | null,
  bookingId: string,
  source: string,
): void {
  switch (outcome) {
    case ConfirmOutcome.Confirmed:
    case ConfirmOutcome.AlreadyProcessed:
      return;
    case ConfirmOutcome.ConfirmedUnclaimed:
      alertCharge(MSG_UNCLAIMED, `${source}-confirmed-unclaimed`, bookingId);
      return;
    case ConfirmOutcome.LatePaymentRefunded:
      alertCharge(MSG_LATE_REFUNDED, `${source}-late-payment-refunded`, bookingId);
      return;
    case ConfirmOutcome.DuplicatePayment:
      alertCharge(MSG_MANUAL_REFUND, `${source}-duplicate-payment`, bookingId, 'error');
      return;
    case ConfirmOutcome.LatePaymentRefundBlocked:
      alertCharge(MSG_MANUAL_REFUND, `${source}-late-payment-refund-blocked`, bookingId, 'error');
      return;
    case ConfirmOutcome.OverbookedRefunded:
      alertCharge(MSG_OVERBOOKED, `${source}-overbooked-refunded`, bookingId);
      return;
    case ConfirmOutcome.PaymentMismatch:
      alertCharge(MSG_MISMATCH, `${source}-mismatch`, bookingId, 'error');
      return;
    case ConfirmOutcome.Ignored:
    case null:
      // El dinero liquidó y no se pudo asentar solo.
      alertCharge(MSG_IGNORED, `${source}-ignored`, bookingId, 'error');
      return;
    default: {
      // Un valor que el tipo no contempla solo puede llegar de la DB en runtime: nunca en silencio.
      const unknown: never = outcome;
      alertCharge(
        MSG_UNKNOWN_OUTCOME,
        `${source}-unknown-outcome-${String(unknown)}`,
        bookingId,
        'error',
      );
    }
  }
}

export const __testing = { alertForOutcome };
