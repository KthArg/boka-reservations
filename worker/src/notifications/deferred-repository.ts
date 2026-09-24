import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingRow } from './render.js';
import { BOOKING_NOTIFICATION_SELECT } from './repository.js';

// Lecturas de los emails del cobro diferido (spec 0029): la reserva con los datos de tarjeta y
// plazos que muestran los avisos, y si una reserva diferida llegó a cobrarse.

const CHARGED_PAYMENT_STATUSES = new Set(['succeeded', 'refunded']);
const BOOKING_ENTITY_TYPE = 'booking';
const AUTHORIZED_AUDIT_ACTION = 'charge.authorized';

export type DeferredBookingRow = BookingRow & {
  card_last4: string | null;
  recovery_deadline: string | null;
  awaiting_action_until: string | null;
};

export type ChargeSummary = { deferred: boolean; charged: boolean };

export async function loadDeferredBooking(
  db: SupabaseClient,
  bookingId: string,
): Promise<DeferredBookingRow | null> {
  const { data, error } = await db
    .from('bookings')
    .select(`${BOOKING_NOTIFICATION_SELECT}, card_last4, recovery_deadline, awaiting_action_until`)
    .eq('id', bookingId)
    .maybeSingle();

  if (error) throw new Error(`load deferred booking: ${error.message}`);
  return (data as unknown as DeferredBookingRow | null) ?? null;
}

/** Diferida = tiene tarjeta guardada; cobrada = algún pago liquidó (aunque luego se reembolsara). */
export async function loadChargeSummary(
  db: SupabaseClient,
  bookingId: string,
): Promise<ChargeSummary> {
  const { data, error } = await db
    .from('bookings')
    .select('payment_method_id, payments(status)')
    .eq('id', bookingId)
    .maybeSingle<{ payment_method_id: string | null; payments: { status: string }[] }>();

  if (error) throw new Error(`load charge summary: ${error.message}`);
  return {
    deferred: data?.payment_method_id != null,
    charged: (data?.payments ?? []).some((payment) => CHARGED_PAYMENT_STATUSES.has(payment.status)),
  };
}

/**
 * Si la reserva llegó a tener una autorización (retención temporal) sobre la tarjeta. Se lee del
 * audit log y no de `bookings.authorized_at` porque soltar la autorización limpia esa marca
 * (spec 0033 §5.12): cuando el email sale, la reserva ya no la tiene.
 */
export async function wasAuthorized(db: SupabaseClient, bookingId: string): Promise<boolean> {
  const { data, error } = await db
    .from('audit_logs')
    .select('id')
    .eq('entity_type', BOOKING_ENTITY_TYPE)
    .eq('entity_id', bookingId)
    .eq('action', AUTHORIZED_AUDIT_ACTION)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(`load authorization audit: ${error.message}`);
  return data !== null;
}
