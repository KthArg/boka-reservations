import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnvopayChargeClient } from './onvopay.js';
import type { InFlightCharge } from './in-flight-repository.js';
import {
  decideInFlight,
  IntentStatus,
  intentStatusOf,
  isConfirmable,
  WatchAction,
} from './decide.js';
import {
  CancelInFlightReason,
  cancelChargeInFlight,
  recordAttemptFailed,
  registerRequiresAction,
  type CancelInFlightReasonValue,
} from './rpc.js';
import { settleSucceeded } from './settle.js';
import { cancelIntentBestEffort } from './cancel-intent.js';
import { unreachable } from './exhaustive.js';
import {
  alertCharge,
  MSG_IN_FLIGHT_WITHOUT_PAYMENT,
  MSG_INTENT_NOT_FOUND,
  MSG_STUCK_PROCESSING,
  MSG_UNEXPECTED_INTENT,
} from './alerts.js';

const SOURCE = 'watch-charges';
const ERROR_CODE_PREFIX = 'intent_';

type CancelAction =
  | WatchAction.CancelActionExpired
  | WatchAction.CancelRecoveryExpired
  | WatchAction.CancelDepartureStarted;

const CANCEL_REASON: Record<CancelAction, CancelInFlightReasonValue> = {
  [WatchAction.CancelActionExpired]: CancelInFlightReason.ActionExpired,
  [WatchAction.CancelRecoveryExpired]: CancelInFlightReason.RecoveryExpired,
  [WatchAction.CancelDepartureStarted]: CancelInFlightReason.DepartureStarted,
};

/**
 * Resuelve UN cobro en vuelo (§5.5). Regla de oro (§5.6): se decide por el GET del intent, nunca
 * por lo que respondió el confirm; y jamás se re-confirma ni se crea un intent desde acá.
 */
export async function watchOne(
  db: SupabaseClient,
  client: OnvopayChargeClient,
  charge: InFlightCharge,
  now: Date,
): Promise<void> {
  const payment = charge.payments[0];
  if (!payment) {
    alertCharge(MSG_IN_FLIGHT_WITHOUT_PAYMENT, `${SOURCE}-without-payment`, charge.id, 'error');
    return;
  }

  const intent = await client.getIntent(payment.external_payment_id);
  const status = intentStatusOf(intent);
  if (status === IntentStatus.NotFound) {
    alertCharge(MSG_INTENT_NOT_FOUND, `${SOURCE}-intent-not-found`, charge.id, 'error');
  }

  const action = decideInFlight(
    status,
    {
      chargeStartedAt: new Date(charge.charge_started_at),
      awaitingActionUntil: toDate(charge.awaiting_action_until),
      recoveryDeadline: toDate(charge.recovery_deadline),
      startsAt: new Date(charge.tour_instance.starts_at),
    },
    now,
  );

  switch (action) {
    case WatchAction.Wait:
      return;
    case WatchAction.Confirm:
      if (intent) await settleSucceeded(db, charge.id, payment, intent, SOURCE);
      return;
    case WatchAction.RegisterAction:
      await registerRequiresAction(db, charge.id, payment.external_payment_id);
      return;
    case WatchAction.RecordRetryable:
    case WatchAction.RecordTerminal:
      await recordAttemptFailed(
        db,
        charge.id,
        payment.external_payment_id,
        `${ERROR_CODE_PREFIX}${status}`,
        action === WatchAction.RecordTerminal,
      );
      return;
    case WatchAction.CancelActionExpired:
    case WatchAction.CancelRecoveryExpired:
    case WatchAction.CancelDepartureStarted: {
      // La función exige que el plazo invocado haya vencido; el intent se cancela solo si todavía
      // puede cobrar (uno ya cerrado respondería 400 y no hay nada que cancelar).
      const cancelled = await cancelChargeInFlight(db, charge.id, CANCEL_REASON[action]);
      if (cancelled && isConfirmable(status)) {
        await cancelIntentBestEffort(client, charge.id, payment.external_payment_id, SOURCE);
      }
      return;
    }
    case WatchAction.AlertStuck:
      alertCharge(MSG_STUCK_PROCESSING, `${SOURCE}-stuck-processing`, charge.id, 'error');
      return;
    case WatchAction.AlertUnexpected:
      alertCharge(MSG_UNEXPECTED_INTENT, `${SOURCE}-unexpected-intent`, charge.id, 'error');
      return;
    default:
      unreachable(action);
  }
}

function toDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}
