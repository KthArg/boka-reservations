import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getPaymentProvider } from '@/lib/payments';
import type { IntentSnapshot, PaymentProvider } from '@/lib/payments/types';
import { BookingStatus, PaymentStatus } from '@shared/constants/enums';
import {
  ManualChargeOutcome,
  outcomeForStart,
  type ManualChargeOutcomeValue,
} from './manual-charge-outcomes';
import {
  loadChargeableBooking,
  prepareIntent,
  type ChargeableBooking,
} from './manual-charge-intent';
import { recordConfirmResult, settleCharge } from './manual-charge-settle';
import {
  alertConfirmUnanswered,
  alertIntentNotCancelled,
  alertManualChargeReview,
  ManualChargeReview,
} from './manual-charge-alerts';

// Cobro manual de una reserva sin cobrar desde el panel (spec 0029 §5.11). "Cobrar ahora" y
// "Volver a cobrar" son la misma operación: preparar el intent (§5.6), registrar el inicio bajo lock
// con charge_booking_start y confirmar con la tarjeta guardada. La función SQL toma el lock de la
// reserva y exige una hora entre intentos: un doble click o dos staff a la vez no cobran dos veces.

type ServiceClient = SupabaseClient<Database>;
type ReadyIntent = { externalPaymentId: string; created: boolean };

const STARTED = 'started';
const INTENT_MISMATCH = 'intent_mismatch';
/** Destino si OnvoPay usa el 3DS por redirección; el turista lo completa con el enlace del email. */
const CHECKOUT_SUCCESS_PATH = 'checkout/success';

/** Ningún intent sin su fila (§5.6): el recién creado se cancela; uno reutilizado se conserva. */
async function discardCreated(provider: PaymentProvider, bookingId: string, intent: ReadyIntent) {
  if (!intent.created) return;
  await provider
    .cancelPaymentSession(intent.externalPaymentId)
    .catch(() => alertIntentNotCancelled(bookingId, intent.externalPaymentId));
}

/** Tras un error de la RPC, ¿quedó el cobro registrado? null si ni siquiera se pudo leer. */
async function startWasApplied(db: ServiceClient, bookingId: string, intentId: string) {
  const { data, error } = await db
    .from('bookings')
    .select('status, payments(external_payment_id, status)')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) return null;
  const row = data as {
    status: string;
    payments: { external_payment_id: string; status: string }[];
  } | null;
  return (
    row?.status === BookingStatus.PendingPayment &&
    row.payments.some(
      (p) => p.external_payment_id === intentId && p.status === PaymentStatus.Pending,
    )
  );
}

async function startCharge(
  db: ServiceClient,
  provider: PaymentProvider,
  booking: ChargeableBooking,
  intent: ReadyIntent,
  actorId: string,
): Promise<string> {
  const { data, error } = await db.rpc('charge_booking_start', {
    p_booking_id: booking.id,
    p_external_payment_id: intent.externalPaymentId,
    p_payment_method_id: booking.paymentMethodId,
    p_actor_id: actorId,
  });
  if (!error) {
    if (data !== STARTED) await discardCreated(provider, booking.id, intent);
    return data;
  }
  // Un error de red tras el commit no significa "no se aplicó": se relee antes de cancelar.
  const appliedStart = await startWasApplied(db, booking.id, intent.externalPaymentId);
  if (appliedStart) return STARTED;
  if (appliedStart === null) {
    alertManualChargeReview(ManualChargeReview.StartUnknown, booking.id, intent.externalPaymentId);
  } else {
    await discardCreated(provider, booking.id, intent);
  }
  throw new Error(`charge_booking_start: ${error.message}`);
}

export async function chargeBookingManually(
  db: ServiceClient,
  bookingId: string,
  actorId: string,
  appUrl: string,
): Promise<ManualChargeOutcomeValue> {
  const booking = await loadChargeableBooking(db, bookingId);
  if (!booking) return ManualChargeOutcome.NotChargeable;

  const provider = getPaymentProvider();
  const prepared = await prepareIntent(db, provider, booking);
  if (prepared.kind === 'settle') {
    return settleCharge(db, booking, prepared.externalPaymentId, prepared.snapshot);
  }
  if (prepared.kind === 'wait') return ManualChargeOutcome.InProgress;
  if (prepared.kind === 'too_soon') return ManualChargeOutcome.TooSoon;
  if (prepared.kind === 'review') return ManualChargeOutcome.Review;

  const intentId = prepared.externalPaymentId;
  const started = await startCharge(db, provider, booking, prepared, actorId);
  if (started !== STARTED) {
    if (started === INTENT_MISMATCH) {
      alertManualChargeReview(ManualChargeReview.IntentMismatch, booking.id, intentId);
    }
    return outcomeForStart(started);
  }

  const returnUrl = `${appUrl}/${booking.locale}/${CHECKOUT_SUCCESS_PATH}?booking=${booking.id}`;
  let snapshot: IntentSnapshot;
  try {
    snapshot = await provider.confirmWithPaymentMethod(
      intentId,
      booking.paymentMethodId,
      returnUrl,
    );
  } catch {
    // Resultado DESCONOCIDO (timeout o 5xx): nunca se re-confirma a ciegas. El cobro queda en vuelo
    // y watch-charges lo resuelve por GET cuando pase su gracia.
    alertConfirmUnanswered(booking.id, intentId);
    return ManualChargeOutcome.InProgress;
  }
  return recordConfirmResult(db, booking, intentId, snapshot);
}
