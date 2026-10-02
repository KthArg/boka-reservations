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

type CycleRow = {
  tour_instance: { staff_decision_required_at: string | null; minimum_resolved_at: string | null };
};

/**
 * Plazo del ciclo de cobro de la salida, mientras siga abierto y sin resolver (spec 0033). Es el
 * momento en que una salida bajo el mínimo se suelta y se cancela: después de eso, cambiar la
 * tarjeta o autenticar ya no la salva. `null` si no hay ciclo abierto.
 */
export async function loadOpenCycleDeadline(
  db: SupabaseClient,
  bookingId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('bookings')
    .select('tour_instance:tour_instances!inner(staff_decision_required_at, minimum_resolved_at)')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) throw new Error(`load cycle deadline: ${error.message}`);
  const instance = (data as unknown as CycleRow | null)?.tour_instance;
  if (!instance || instance.minimum_resolved_at !== null) return null;
  return instance.staff_decision_required_at;
}

/**
 * El plazo que se le promete al turista: el de su reserva o el del ciclo de la salida, el que
 * venza primero. Un plazo del ciclo ya vencido no cuenta: la salida espera a una persona y la
 * reserva sigue viva hasta el suyo.
 */
export function promisedDeadline(
  bookingDeadline: string,
  cycleDeadline: string | null,
  now: Date = new Date(),
): string {
  if (cycleDeadline === null) return bookingDeadline;
  const cycle = new Date(cycleDeadline).getTime();
  if (cycle <= now.getTime()) return bookingDeadline;
  return cycle < new Date(bookingDeadline).getTime() ? cycleDeadline : bookingDeadline;
}

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
