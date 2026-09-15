import { BookingState, HoldState, PaymentRowState } from './statuses.js';

// Cuándo borrar en OnvoPay el customer de un checkout (spec 0029 §5.2, §5.9; Ley 8968, spec 0022).
// Decisión pura: el customer se borra solo cuando ninguna reserva suya puede volver a cobrarse ni
// tiene un intent potencialmente abierto. Borrarlo antes rompería un reintento o la actualización
// de tarjeta; no borrarlo nunca deja datos del turista sin reserva que los justifique. Decide por
// las reservas de UN hold: el índice único tour_holds_one_per_customer (…044) lo garantiza.

/** Holds que ya no reservan cupo: el checkout terminó sin reserva o la reserva se cerró. */
const RELEASED_HOLDS = new Set<string>([HoldState.Expired, HoldState.Released]);
/**
 * Reservas cerradas que no se vuelven a cobrar. payment_mismatch no está: queda en revisión manual
 * y la resolución puede necesitar la tarjeta.
 */
const CLOSED_BOOKINGS = new Set<string>([
  BookingState.Cancelled,
  BookingState.Refunded,
  BookingState.OverbookedRefunded,
]);

export type CleanupPayment = { status: string; providerClosedAt: string | null };

export type CleanupBooking = {
  status: string;
  startsAt: string;
  payments: CleanupPayment[];
};

export type CleanupCandidateView = {
  holdStatus: string;
  bookings: CleanupBooking[];
};

function hasOpenIntent(booking: CleanupBooking): boolean {
  return booking.payments.some(
    (payment) =>
      payment.status === PaymentRowState.Pending ||
      (payment.status === PaymentRowState.Failed && payment.providerClosedAt === null),
  );
}

function releasesCustomer(booking: CleanupBooking, now: Date): boolean {
  if (hasOpenIntent(booking)) return false;
  if (CLOSED_BOOKINGS.has(booking.status)) return true;
  // Confirmada: ya no se cobra más, pero se conserva hasta que la salida empiece por si hubiera
  // que actualizar algo de la reserva; los refunds usan el intent, no el customer.
  return booking.status === BookingState.Confirmed && new Date(booking.startsAt) <= now;
}

export function isCustomerCleanupDue(candidate: CleanupCandidateView, now: Date): boolean {
  if (candidate.bookings.length === 0) return RELEASED_HOLDS.has(candidate.holdStatus);
  return candidate.bookings.every((booking) => releasesCustomer(booking, now));
}
