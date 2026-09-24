import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnvopayChargeClient } from './onvopay.js';
import { IntentStatus, isClosedIntentStatus, isConfirmable } from './decide.js';
import {
  fetchDepartureBookings,
  fetchPendingIntent,
  markCaptureStarted,
  type ChargeableBooking,
} from './departure-repository.js';
import { releaseAuthorization } from './departure-rpc.js';
import { BookingState } from './statuses.js';
import { settleSucceeded } from './settle.js';
import { recordAttemptFailed, ConfirmOutcome } from './rpc.js';
import { alertCharge } from './alerts.js';

// Los dos finales posibles del ciclo (spec 0033 §5.3, paso 4): capturar todas las autorizaciones
// o soltarlas. Capturar mueve plata; soltar no cuesta nada.

const MSG_CAPTURE_FAILED = '[charge-departures] captura fallida';
const MSG_RELEASE_FAILED = '[charge-departures] la autorización no se pudo soltar';

/** Captura todas las autorizaciones de la salida. `false` si alguna quedó sin terminar. */
export async function captureAll(
  db: SupabaseClient,
  onvopay: OnvopayChargeClient,
  instanceId: string,
): Promise<boolean> {
  const bookings = await fetchDepartureBookings(db, instanceId);
  let allDone = true;
  for (const booking of bookings) {
    if (booking.status !== BookingState.PendingPayment || booking.authorized_at === null) continue;
    if (booking.cancel_claimed_at !== null) {
      allDone = false;
      continue;
    }
    const intentId = await fetchPendingIntent(db, booking.id);
    if (!intentId) continue;
    // La marca es lo que excluye una cancelación del turista mientras hablamos con OnvoPay.
    if (!(await markCaptureStarted(db, booking.id))) {
      allDone = false;
      continue;
    }
    if (!(await captureOne(db, onvopay, booking, intentId))) allDone = false;
  }
  return allDone;
}

async function captureOne(
  db: SupabaseClient,
  onvopay: OnvopayChargeClient,
  booking: ChargeableBooking,
  intentId: string,
): Promise<boolean> {
  let snapshot;
  try {
    snapshot = await onvopay.captureIntent(intentId);
  } catch {
    // Respuesta desconocida: se relee en vez de recapturar a ciegas (§5.4). Si la relectura
    // también falla, la reserva queda como está y la decide la corrida siguiente.
    snapshot = await onvopay.getIntent(intentId).catch(() => undefined);
  }
  if (!snapshot) {
    alertCharge(MSG_CAPTURE_FAILED, 'capture-unknown', booking.id, 'error');
    return false;
  }
  if (snapshot.status === IntentStatus.Succeeded) {
    const outcome = await settleSucceeded(
      db,
      booking.id,
      {
        external_payment_id: intentId,
        amount_cents: booking.total_amount_cents,
        currency: booking.currency,
      },
      snapshot,
      'charge-departures-capture',
    );
    // Cualquier outcome que no confirme deja plata cobrada sin reserva confirmada: lo decide una
    // persona (§5.4). settleSucceeded ya alertó el detalle.
    return outcome === ConfirmOutcome.Confirmed || outcome === ConfirmOutcome.ConfirmedUnclaimed;
  }
  // `requires_capture` (la captura no llegó) y `processing` (la pasarela todavía puede liquidar)
  // no son rechazos: registrarlos como fallo cerraría el pago con la plata en el aire.
  if (snapshot.status === IntentStatus.RequiresCapture) return false;
  if (snapshot.status === IntentStatus.Processing) return false;
  await recordAttemptFailed(db, booking.id, intentId, snapshot.status, true);
  return false;
}

/**
 * Suelta todas las autorizaciones de la salida. Soltar no deja transacción de balance (§5.4). La
 * reserva solo se marca soltada cuando la pasarela confirmó el cierre: darlo por hecho sacaría al
 * intent de la cola de close-payment-intents y dejaría una retención viva que nadie mira.
 */
export async function releaseAll(
  db: SupabaseClient,
  onvopay: OnvopayChargeClient,
  instanceId: string,
): Promise<void> {
  const bookings = await fetchDepartureBookings(db, instanceId);
  for (const booking of bookings) {
    if (booking.status !== BookingState.PendingPayment) continue;
    const intentId = await fetchPendingIntent(db, booking.id);
    if (!intentId) continue;
    const snapshot = await onvopay.getIntent(intentId);
    const status = snapshot?.status ?? IntentStatus.NotFound;
    // Un intent que ya cobró no se suelta: lo asienta el watchdog por el camino de siempre.
    if (status === IntentStatus.Succeeded) continue;
    if (isConfirmable(status) && !(await cancelled(onvopay, intentId, booking.id))) continue;
    // Cerrado o inexistente: no hay nada que cancelar y la retención no existe.
    if (!isConfirmable(status) && !isClosedIntentStatus(status)) continue;
    await releaseAuthorization(db, booking.id, intentId);
  }
}

async function cancelled(
  onvopay: OnvopayChargeClient,
  intentId: string,
  bookingId: string,
): Promise<boolean> {
  try {
    await onvopay.cancelIntent(intentId);
    return true;
  } catch {
    // Se reintenta en la corrida siguiente: la reserva sigue autorizada y la retención viva.
    alertCharge(MSG_RELEASE_FAILED, 'release-failed', bookingId, 'error');
    return false;
  }
}
