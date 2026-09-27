import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import type { OnvopayChargeClient } from './onvopay.js';
import { IntentStatus, isClosedIntentStatus } from './decide.js';
import { canAttempt, isStaleMark } from './departure-cycle.js';
import {
  clearStaleMarks,
  fetchDepartureBookings,
  fetchPendingIntent,
  type ChargeableBooking,
} from './departure-repository.js';
import { closePendingPayment, recordAuthorization, startCharge } from './departure-rpc.js';
import { BookingState } from './statuses.js';
import { settleSucceeded } from './settle.js';
import { recordAttemptFailed, registerRequiresAction } from './rpc.js';
import { alertCharge } from './alerts.js';

// Autorización del ciclo del mínimo (spec 0033 §5.3, paso 3): se confirma con captura manual, así
// que la plata queda reservada y todavía no cobrada.

const MSG_AUTH_NOT_RECORDED = '[charge-departures] autorización viva sin registrar';

export async function authorizePending(
  db: SupabaseClient,
  onvopay: OnvopayChargeClient,
  instanceId: string,
  now: Date,
): Promise<void> {
  const bookings = await fetchDepartureBookings(db, instanceId);
  for (const booking of bookings) {
    await clearMarksIfStale(db, booking, now);
    if (!booking.payment_method_id) continue;
    // Huérfana (§5.3): el worker murió entre el confirm y el registro, así que la retención está
    // viva y nadie la reclama. Se adopta antes de mirar reintentos: no hay nada que reintentar.
    if (booking.status === BookingState.PendingPayment && booking.authorized_at === null) {
      await adoptOrphan(db, onvopay, booking);
      continue;
    }
    if (booking.status !== BookingState.PendingMinimum || !canAttempt(booking, now)) continue;
    await authorizeOne(db, onvopay, booking);
  }
}

async function clearMarksIfStale(
  db: SupabaseClient,
  booking: ChargeableBooking,
  now: Date,
): Promise<void> {
  const claim = booking.cancel_claimed_at ? new Date(booking.cancel_claimed_at) : null;
  const capture = booking.capture_started_at ? new Date(booking.capture_started_at) : null;
  if (isStaleMark(claim, now) || isStaleMark(capture, now)) {
    await clearStaleMarks(db, booking.id);
  }
}

/** Adopta la retención que quedó viva sin registro, o cierra el intent si ya no puede cobrar. */
async function adoptOrphan(
  db: SupabaseClient,
  onvopay: OnvopayChargeClient,
  booking: ChargeableBooking,
): Promise<void> {
  const intentId = await fetchPendingIntent(db, booking.id);
  if (!intentId) return;
  const snapshot = await onvopay.getIntent(intentId);
  const status = snapshot?.status ?? IntentStatus.NotFound;
  if (status === IntentStatus.RequiresCapture) {
    await record(db, booking.id, intentId);
    return;
  }
  // Muerto: se registra como intento fallido, que cierra la fila y devuelve la reserva a
  // pending_minimum con su backoff. Sin eso, charge_booking_start responde `intent_mismatch`
  // para siempre y la reserva no se vuelve a intentar nunca.
  if (isClosedIntentStatus(status)) {
    await recordAttemptFailed(db, booking.id, intentId, `intent_${status}`, true);
  }
}

/**
 * Autoriza una reserva sin capturar. Antes de crear un intent nuevo revisa el que haya quedado
 * vivo: si el worker murió entre el confirm y el registro, la retención existe y duplicarla le
 * retendría al turista el doble.
 */
async function authorizeOne(
  db: SupabaseClient,
  onvopay: OnvopayChargeClient,
  booking: ChargeableBooking,
): Promise<void> {
  const paymentMethodId = booking.payment_method_id as string;
  const existing = await fetchPendingIntent(db, booking.id);
  if (existing) {
    const snapshot = await onvopay.getIntent(existing);
    const status = snapshot?.status ?? IntentStatus.NotFound;
    if (status === IntentStatus.RequiresCapture) {
      await record(db, booking.id, existing);
      return;
    }
    if (isClosedIntentStatus(status)) await closePendingPayment(db, booking.id, existing);
  }

  const intentId = await onvopay.createManualCaptureIntent({
    amountCents: booking.total_amount_cents,
    currency: booking.currency,
    description: `Reserva ${booking.id}`,
  });

  if (!(await startCharge(db, booking.id, intentId, paymentMethodId))) {
    await onvopay.cancelIntent(intentId).catch(() => undefined);
    return;
  }

  const returnUrl = `${env.APP_URL}/${booking.locale}/checkout/success?booking=${booking.id}`;
  const snapshot = await onvopay.confirmIntent(intentId, { paymentMethodId, returnUrl });

  if (snapshot.status === IntentStatus.RequiresCapture) {
    await record(db, booking.id, intentId);
    return;
  }
  if (snapshot.status === IntentStatus.RequiresAction) {
    await registerRequiresAction(db, booking.id, intentId);
    return;
  }
  if (snapshot.status === IntentStatus.Succeeded) {
    await settleSucceeded(
      db,
      booking.id,
      {
        external_payment_id: intentId,
        amount_cents: booking.total_amount_cents,
        currency: booking.currency,
      },
      snapshot,
      'charge-departures',
    );
    return;
  }

  const terminal =
    snapshot.status === IntentStatus.Canceled || snapshot.status === IntentStatus.Failed;
  await recordAttemptFailed(db, booking.id, intentId, snapshot.status, terminal);
}

/** Una autorización que no queda registrada es plata retenida que nadie va a soltar. */
async function record(db: SupabaseClient, bookingId: string, intentId: string): Promise<void> {
  if (!(await recordAuthorization(db, bookingId, intentId))) {
    alertCharge(MSG_AUTH_NOT_RECORDED, 'authorization-not-recorded', bookingId, 'error');
  }
}
