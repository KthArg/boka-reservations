import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { PaymentIntentStatus, type IntentSnapshot } from '@/lib/payments/types';
import { BookingStatus, ConfirmBookingOutcome } from '@shared/constants/enums';
import { ManualChargeOutcome, type ManualChargeOutcomeValue } from './manual-charge-outcomes';
import type { ChargeableBooking } from './manual-charge-intent';
import { alertManualChargeReview, ManualChargeReview } from './manual-charge-alerts';

// Registro del resultado del cobro manual (spec 0029 §5.6, §5.7): se decide por el status del
// intent, con las mismas funciones SQL que el worker. Un cobro liquidado se asienta con la misma
// clave de idempotencia que el webhook (p_event_id = id del intent).

type ServiceClient = SupabaseClient<Database>;
type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

const DECLINED_ERROR_CODE = 'card_declined';
const MISMATCH_SOURCE = 'manual-charge';
const CONFIRMED_OUTCOMES = new Set<string>([
  ConfirmBookingOutcome.Confirmed,
  ConfirmBookingOutcome.ConfirmedUnclaimed,
]);

/** Escritura condicional: false es rowcount 0 (§5.6), que alerta y no se reintenta. */
async function applied(result: RpcResult, fn: string): Promise<boolean> {
  const { data, error } = await result;
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data === true;
}

async function isConfirmed(db: ServiceClient, bookingId: string): Promise<boolean> {
  const { data, error } = await db.from('bookings').select('status').eq('id', bookingId).single();
  if (error) throw new Error(`load booking status: ${error.message}`);
  return data.status === BookingStatus.Confirmed;
}

/** Asienta un intent liquidado: nunca a ciegas, el monto y la moneda tienen que coincidir. */
export async function settleCharge(
  db: ServiceClient,
  booking: ChargeableBooking,
  intentId: string,
  snapshot: IntentSnapshot,
): Promise<ManualChargeOutcomeValue> {
  // Sin monto no se puede verificar: no se toca la reserva (igual que el worker).
  if (snapshot.amountCents === undefined || snapshot.currency === undefined) {
    alertManualChargeReview(ManualChargeReview.SettledWithoutAmount, booking.id, intentId);
    return ManualChargeOutcome.Review;
  }

  const currencyMatches = snapshot.currency.toUpperCase() === booking.currency.toUpperCase();
  if (snapshot.amountCents !== booking.totalAmountCents || !currencyMatches) {
    await applied(
      db.rpc('flag_payment_mismatch', {
        p_booking_id: booking.id,
        p_paid_amount_cents: snapshot.amountCents,
        p_paid_currency: snapshot.currency,
        p_source: MISMATCH_SOURCE,
      }),
      'flag_payment_mismatch',
    );
    alertManualChargeReview(ManualChargeReview.Mismatch, booking.id, intentId);
    return ManualChargeOutcome.Mismatch;
  }

  const { data: outcome, error } = await db.rpc('confirm_booking', {
    p_booking_id: booking.id,
    p_external_payment_id: intentId,
    p_event_id: intentId,
    p_paid_amount_cents: snapshot.amountCents,
    p_paid_currency: snapshot.currency,
  });
  if (error) throw new Error(`confirm_booking: ${error.message}`);
  if (CONFIRMED_OUTCOMES.has(outcome ?? '')) return ManualChargeOutcome.Confirmed;
  // El evento ya estaba consumido: solo es "confirmada" si la reserva realmente lo está (el webhook
  // pudo haberla dejado en sobreventa o mismatch).
  if (outcome === ConfirmBookingOutcome.AlreadyProcessed && (await isConfirmed(db, booking.id))) {
    return ManualChargeOutcome.Confirmed;
  }
  alertManualChargeReview(ManualChargeReview.SettledNotConfirmed, booking.id, intentId);
  return ManualChargeOutcome.Review;
}

/** Registra lo que devolvió el confirm. Una respuesta vieja no toca otro intento (gate por intent). */
export async function recordConfirmResult(
  db: ServiceClient,
  booking: ChargeableBooking,
  intentId: string,
  snapshot: IntentSnapshot,
): Promise<ManualChargeOutcomeValue> {
  switch (snapshot.status) {
    case PaymentIntentStatus.Succeeded:
      return settleCharge(db, booking, intentId, snapshot);
    case PaymentIntentStatus.RequiresPaymentMethod:
    case PaymentIntentStatus.Canceled:
    case PaymentIntentStatus.Failed: {
      const recorded = await applied(
        db.rpc('charge_attempt_failed', {
          p_booking_id: booking.id,
          p_external_payment_id: intentId,
          p_error_code: DECLINED_ERROR_CODE,
          p_intent_terminal: snapshot.status !== PaymentIntentStatus.RequiresPaymentMethod,
        }),
        'charge_attempt_failed',
      );
      return recorded ? ManualChargeOutcome.Declined : skipped(booking.id, intentId);
    }
    case PaymentIntentStatus.RequiresAction: {
      const recorded = await applied(
        db.rpc('charge_requires_action', {
          p_booking_id: booking.id,
          p_external_payment_id: intentId,
        }),
        'charge_requires_action',
      );
      return recorded ? ManualChargeOutcome.RequiresAction : skipped(booking.id, intentId);
    }
    case PaymentIntentStatus.Processing:
      return ManualChargeOutcome.Processing;
    default:
      alertManualChargeReview(ManualChargeReview.UnexpectedIntent, booking.id, intentId);
      return ManualChargeOutcome.Review;
  }
}

/** Otro actor resolvió la reserva entre el confirm y el registro: no salió ningún aviso. */
function skipped(bookingId: string, intentId: string): ManualChargeOutcomeValue {
  alertManualChargeReview(ManualChargeReview.RegistrationSkipped, bookingId, intentId);
  return ManualChargeOutcome.Review;
}
