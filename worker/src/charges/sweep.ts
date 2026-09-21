import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnvopayChargeClient } from './onvopay.js';
import {
  decideSweep,
  IntentStatus,
  intentStatusOf,
  isClosedIntentStatus,
  SweepAction,
} from './decide.js';
import { isPendingRow, type UnclosedIntent } from './sweep-repository.js';
import { ConfirmOutcome, recordIntentClosed } from './rpc.js';
import { settleSucceeded } from './settle.js';
import { unreachable } from './exhaustive.js';
import {
  alertCharge,
  MSG_INTENT_NOT_FOUND,
  MSG_PENDING_ON_CANCELLED,
  MSG_SETTLED_ELSEWHERE,
  MSG_UNEXPECTED_INTENT,
} from './alerts.js';

const SOURCE = 'close-payment-intents';

/**
 * Cierra UN intent de una reserva cancelada (§5.9): si liquidó, lo asienta por confirm_booking
 * (camino late_payment_refunded, refund total); si todavía es confirmable, lo cancela y el ciclo
 * siguiente comprueba el cierre; si ya está cerrado, lo registra. Un fallo HTTP lanza: el job lo
 * aísla y el ciclo siguiente lo reintenta.
 */
export async function sweepOne(
  db: SupabaseClient,
  client: OnvopayChargeClient,
  intent: UnclosedIntent,
): Promise<void> {
  if (isPendingRow(intent)) {
    alertCharge(MSG_PENDING_ON_CANCELLED, `${SOURCE}-pending-on-cancelled`, intent.booking_id);
  }

  const snapshot = await client.getIntent(intent.external_payment_id);
  const status = intentStatusOf(snapshot);
  const action = decideSweep(status);

  switch (action) {
    case SweepAction.Confirm: {
      if (!snapshot) return;
      const outcome = await settleSucceeded(db, intent.booking_id, intent, snapshot, SOURCE);
      // El evento ya estaba consumido pero esta fila sigue sin asentar: nadie la va a cerrar sola
      // y se volvería a seleccionar en silencio hasta que venza la ventana.
      if (outcome === ConfirmOutcome.AlreadyProcessed) {
        alertCharge(MSG_SETTLED_ELSEWHERE, `${SOURCE}-already-processed`, intent.booking_id);
      }
      return;
    }
    case SweepAction.Cancel:
      // No se marca cerrado acá: el cierre se registra recién cuando un GET lo confirma.
      await client.cancelIntent(intent.external_payment_id);
      return;
    case SweepAction.MarkClosed:
      if (status === IntentStatus.NotFound) {
        alertCharge(MSG_INTENT_NOT_FOUND, `${SOURCE}-intent-not-found`, intent.booking_id, 'error');
      }
      if (isClosedIntentStatus(status)) await recordIntentClosed(db, intent.id, status);
      return;
    case SweepAction.Wait:
      return;
    case SweepAction.AlertUnexpected:
      alertCharge(MSG_UNEXPECTED_INTENT, `${SOURCE}-unexpected-intent`, intent.booking_id, 'error');
      return;
    default:
      unreachable(action);
  }
}
