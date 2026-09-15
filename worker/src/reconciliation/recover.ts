import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentIntentResult } from './onvopay.js';
import {
  confirmRecoveredBooking,
  ConfirmOutcome,
  flagPaymentMismatch,
  writeRecoveredAudit,
  type StalePendingBooking,
} from './repository.js';
import {
  alert,
  MSG_IGNORED,
  MSG_LATE,
  MSG_MANUAL_REFUND,
  MSG_MISMATCH,
  MSG_OVERBOOKED,
  MSG_RECOVERED,
  MSG_UNCLAIMED,
  MSG_UNVERIFIABLE,
} from './alerts.js';

/**
 * Recupera una reserva cuyo pago figura succeeded en OnvoPay (webhook perdido).
 * Extraída del job por el límite de 150 líneas (spec 0028); la orquestación del
 * ciclo sigue en jobs/reconcile-pending-payments.ts.
 */
export async function recover(
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
    alert(MSG_UNVERIFIABLE, 'reconcile-amount-unverifiable', booking.id);
    return;
  }
  // (b) Si el monto/moneda no coincide con lo esperado, marcar payment_mismatch.
  // Moneda normalizada a mayúsculas (ISO 4217 case-insensitive) para no marcar
  // falso-mismatch por formato.
  const currencyMismatch = result.currency.toUpperCase() !== payment.currency.toUpperCase();
  if (result.amountCents !== payment.amount_cents || currencyMismatch) {
    await flagPaymentMismatch(db, booking.id, result.amountCents, result.currency);
    alert(MSG_MISMATCH, 'reconcile-payment-mismatch', booking.id);
    return;
  }

  // (c) Coincide: recuperar (confirmar la reserva como lo haría el webhook). El monto/moneda
  // (ya validados arriba) van al guard de payment_mismatch interno de confirm_booking (spec 0026).
  // El outcome de la RPC (spec 0028) dice qué pasó de verdad — reemplaza la re-lectura del status
  // y cubre la race con la cancelación por staleness (camino late_payment_refunded).
  const outcome = await confirmRecoveredBooking(
    db,
    booking.id,
    payment.external_payment_id,
    result.amountCents,
    result.currency,
  );

  switch (outcome) {
    case ConfirmOutcome.Confirmed: {
      // Una recuperación = un webhook perdido. Señal de salud del sistema, agrupada.
      alert(MSG_RECOVERED, 'reconcile-recovered', booking.id);
      const totalSeats = booking.tickets_adult + booking.tickets_child + booking.tickets_student;
      await writeRecoveredAudit(db, booking.id, {
        seats: totalSeats,
        external_payment_id: payment.external_payment_id,
      });
      return;
    }
    case ConfirmOutcome.ConfirmedUnclaimed:
      // Diferida confirmada sin haber pasado por el cobro (spec 0029 §5.3): revisar el origen.
      alert(MSG_UNCLAIMED, 'reconcile-confirmed-unclaimed', booking.id);
      return;
    case ConfirmOutcome.OverbookedRefunded:
      alert(MSG_OVERBOOKED, 'booking-overbooked-refunded', booking.id);
      return;
    case ConfirmOutcome.LatePaymentRefunded:
      alert(MSG_LATE, 'reconcile-late-payment-refunded', booking.id);
      return;
    case ConfirmOutcome.DuplicatePayment:
      alert(MSG_MANUAL_REFUND, 'reconcile-duplicate-payment', booking.id, 'error');
      return;
    case ConfirmOutcome.LatePaymentRefundBlocked:
      alert(MSG_MANUAL_REFUND, 'reconcile-late-payment-refund-blocked', booking.id, 'error');
      return;
    case ConfirmOutcome.Ignored:
      alert(MSG_IGNORED, 'reconcile-confirm-ignored', booking.id);
      return;
    case ConfirmOutcome.AlreadyProcessed:
    case ConfirmOutcome.PaymentMismatch:
      // Otro actor resolvió en paralelo; nada que hacer.
      return;
    default:
      // Outcome desconocido o nulo: nunca tragarlo en silencio (spec 0029 §5.3).
      alert(MSG_IGNORED, 'reconcile-confirm-unknown-outcome', booking.id);
  }
}
