import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/node';
import { env } from '../env.js';
import {
  createOnvopayPaymentIntentClient,
  PaymentIntentOutcome,
  type OnvopayPaymentIntentClient,
  type PaymentIntentResult,
} from '../reconciliation/onvopay.js';
import {
  cancelStaleBooking,
  confirmRecoveredBooking,
  fetchInstanceCapacity,
  fetchStalePendingBookings,
  flagPaymentMismatch,
  writeRecoveredAudit,
  type StalePendingBooking,
} from '../reconciliation/repository.js';

// Umbrales (worker self-contained: no importa @shared en runtime).
// Antigüedad mínima en pending_payment para procesar una reserva. 2h: muy por
// encima del hold (15 min, spec 0005) y de los reintentos de webhook de OnvoPay.
const STALE_PENDING_PAYMENT_AFTER_MS = 2 * 60 * 60 * 1000;
// Antigüedad a partir de la cual un pago estancado en processing/requires_action
// se reporta a Sentry para revisión manual (nunca se auto-cancela).
const STUCK_PROCESSING_ALERT_AFTER_MS = 24 * 60 * 60 * 1000;
// Lote acotado por ciclo (cada reserva implica un GET a OnvoPay).
const BATCH_SIZE = 50;
const NO_PAYMENT_REASON = 'no_payment';

// Single-flight a nivel módulo: si el ciclo anterior sigue corriendo, este se
// saltea. Evita apilar ciclos y duplicar llamadas a OnvoPay.
let isRunning = false;

/**
 * Reconcilia reservas pending_payment vencidas contra OnvoPay (spec 0013):
 * recupera las pagadas-con-webhook-perdido (confirm_booking) y cancela las
 * abandonadas (cancel_stale_pending_booking). Nunca cancela una reserva con pago
 * sin verificar su estado real en OnvoPay.
 */
export async function reconcilePendingPayments(): Promise<void> {
  if (isRunning) {
    console.warn('[reconcile-pending-payments] ciclo anterior en curso; se omite');
    return;
  }
  isRunning = true;
  try {
    await runCycle();
  } finally {
    isRunning = false;
  }
}

async function runCycle(): Promise<void> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const olderThanIso = new Date(Date.now() - STALE_PENDING_PAYMENT_AFTER_MS).toISOString();
  const bookings = await fetchStalePendingBookings(db, olderThanIso, BATCH_SIZE);
  if (bookings.length === 0) return;

  const client = env.ONVOPAY_SECRET_KEY
    ? createOnvopayPaymentIntentClient(env.ONVOPAY_SECRET_KEY)
    : null;

  for (const booking of bookings) {
    try {
      await reconcileOne(db, client, booking);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('[reconcile-pending-payments] error en reserva', booking.id, message);
      Sentry.captureException(err);
    }
  }
}

async function reconcileOne(
  db: SupabaseClient,
  client: OnvopayPaymentIntentClient | null,
  booking: StalePendingBooking,
): Promise<void> {
  const payment = booking.payments[0];

  // Sin fila de pago: la reserva murió antes de llegar al widget (entre el INSERT
  // del booking y el del payment). No hubo pago posible -> cancelar directo.
  if (!payment) {
    await cancelStaleBooking(db, booking.id, NO_PAYMENT_REASON);
    return;
  }

  // Con pago pero sin forma de verificarlo en OnvoPay: nunca cancelar a ciegas.
  if (!client) {
    console.warn(
      '[reconcile-pending-payments] ONVOPAY_SECRET_KEY ausente; se omite reserva con pago',
      booking.id,
    );
    return;
  }

  const result = await client.getPaymentIntent(payment.external_payment_id);
  await applyOutcome(db, booking, result);
}

async function applyOutcome(
  db: SupabaseClient,
  booking: StalePendingBooking,
  result: PaymentIntentResult,
): Promise<void> {
  switch (result.outcome) {
    case PaymentIntentOutcome.Paid:
      await recover(db, booking, result);
      return;
    case PaymentIntentOutcome.NotPaid:
      await cancelStaleBooking(db, booking.id, result.rawStatus);
      return;
    case PaymentIntentOutcome.Pending:
      alertIfStuck(booking);
      return;
  }
}

async function recover(
  db: SupabaseClient,
  booking: StalePendingBooking,
  result: PaymentIntentResult,
): Promise<void> {
  const payment = booking.payments[0];
  if (!payment) return;

  // Validación de monto (spec 0014): no recuperar a ciegas un pago succeeded.
  // (a) Si OnvoPay no devolvió monto/moneda, es no verificable: saltear sin tocar
  // la reserva (igual que el principio de "nunca a ciegas" del 0013).
  if (result.amountCents === undefined || result.currency === undefined) {
    alert(
      '[reconcile] pago no verificable (sin monto en el GET); revisión manual',
      'reconcile-amount-unverifiable',
      booking.id,
    );
    return;
  }
  // (b) Si el monto/moneda no coincide con lo esperado, marcar payment_mismatch.
  // Moneda normalizada a mayúsculas (ISO 4217 case-insensitive) para no marcar
  // falso-mismatch por formato.
  const currencyMismatch = result.currency.toUpperCase() !== payment.currency.toUpperCase();
  if (result.amountCents !== payment.amount_cents || currencyMismatch) {
    await flagPaymentMismatch(db, booking.id, result.amountCents, result.currency);
    alert(
      '[reconcile] pago con monto/moneda no coincidente',
      'reconcile-payment-mismatch',
      booking.id,
    );
    return;
  }

  // (c) Coincide: recuperar (confirmar la reserva como lo haría el webhook).
  const totalSeats = booking.tickets_adult + booking.tickets_child + booking.tickets_student;
  await confirmRecoveredBooking(db, booking.id, payment.external_payment_id, totalSeats);
  // Una recuperación = un webhook perdido. Señal de salud del sistema, agrupada.
  // Se emite ANTES del audit (best-effort) para no perderla si el audit falla.
  alert('[reconcile] reserva recuperada (webhook perdido)', 'reconcile-recovered', booking.id);
  await writeRecoveredAudit(db, booking.id, {
    seats: totalSeats,
    external_payment_id: payment.external_payment_id,
  });

  // Sobrecupo (spec 0023): confirm_booking honra el pago aunque supere el cupo; si la
  // recuperación dejó capacity_reserved por encima del total, avisar para revisión.
  const instance = await fetchInstanceCapacity(db, booking.tour_instance_id);
  if (instance && instance.capacity_reserved > instance.capacity_total) {
    alert('[reconcile] reserva recuperada en sobrecupo', 'booking-overbooked', booking.id);
  }
}

function alertIfStuck(booking: StalePendingBooking): void {
  const ageMs = Date.now() - new Date(booking.created_at).getTime();
  if (ageMs <= STUCK_PROCESSING_ALERT_AFTER_MS) return;
  // Estancado demasiado tiempo en processing/requires_action: revisión manual.
  alert(
    '[reconcile] pago estancado en processing >24h (revisión manual)',
    'reconcile-stuck-processing',
    booking.id,
  );
}

// Alerta agregada a Sentry: una sola issue por fingerprint, no un evento por
// reserva ni por ciclo. En dev/CI (sin SENTRY_DSN) es no-op.
function alert(message: string, fingerprint: string, bookingId: string): void {
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setFingerprint([fingerprint]);
    scope.setExtra('bookingId', bookingId);
    Sentry.captureMessage(message);
  });
}

export const __testing = { reconcileOne, applyOutcome };
