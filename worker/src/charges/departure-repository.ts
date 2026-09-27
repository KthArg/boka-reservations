import type { SupabaseClient } from '@supabase/supabase-js';
import { BookingState, PaymentRowState } from './statuses.js';

// Lecturas del ciclo de cobro de una salida (spec 0033). Las transiciones viven en
// departure-rpc.ts; acá solo se consulta.

const BATCH_SIZE = 20;
const CANDIDATE_BOOKING_LIMIT = 200;

export type DepartureCandidate = {
  id: string;
  starts_at: string;
  minimum_resolved_at: string | null;
  minimum_resolution: string | null;
  minimum_charge_triggered_at: string | null;
  staff_decision_required_at: string | null;
  tour: { min_participants: number; auto_cancel_below_minimum: boolean };
};

export type ChargeableBooking = {
  id: string;
  status: string;
  total_amount_cents: number;
  currency: string;
  locale: string;
  payment_method_id: string | null;
  authorized_at: string | null;
  cancel_claimed_at: string | null;
  capture_started_at: string | null;
  charge_next_attempt_at: string | null;
  charge_attempts: number;
};

const DEPARTURE_SELECT = `
  id, starts_at, minimum_resolved_at, minimum_resolution, minimum_charge_triggered_at,
  staff_decision_required_at,
  tour:tours!inner ( min_participants, auto_cancel_below_minimum )
`;

const BOOKING_SELECT = `
  id, status, total_amount_cents, currency, locale, payment_method_id, authorized_at,
  cancel_claimed_at, capture_started_at, charge_next_attempt_at, charge_attempts
`;

/**
 * Salidas candidatas: las que tienen al menos una reserva del flujo diferido sin cobrar. Esa
 * condición es la que impide que el motor toque salidas del cobro inmediato, donde cancelar por
 * mínimo sería cancelar reservas ya pagadas (spec 0033 §5.3, paso 1). Se parte de las reservas,
 * como pide el comentario de la migración …043 sobre el índice del mínimo.
 */
export async function fetchDepartureCandidates(
  db: SupabaseClient,
  nowIso: string,
): Promise<DepartureCandidate[]> {
  const { data: rows, error } = await db
    .from('bookings')
    .select('tour_instance_id')
    .in('status', [BookingState.PendingMinimum, BookingState.PendingPayment])
    .not('payment_method_id', 'is', null)
    // Orden determinista: sin él, con más reservas vivas que el límite, siempre podrían quedar
    // afuera las mismas salidas y no cobrarse nunca.
    .order('tour_instance_id', { ascending: true })
    .limit(CANDIDATE_BOOKING_LIMIT);
  if (error) throw new Error(`fetchDepartureCandidates bookings: ${error.message}`);

  const instanceIds = [...new Set((rows ?? []).map((r) => r.tour_instance_id as string))];
  if (instanceIds.length === 0) return [];

  const { data, error: instanceError } = await db
    .from('tour_instances')
    .select(DEPARTURE_SELECT)
    .in('id', instanceIds)
    .neq('status', 'cancelled')
    .gt('starts_at', nowIso)
    .order('starts_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (instanceError) throw new Error(`fetchDepartureCandidates: ${instanceError.message}`);
  return (data ?? []) as unknown as DepartureCandidate[];
}

/** Relee la salida: después de abrir el ciclo, el plazo y la foto del mínimo son nuevos. */
export async function fetchDeparture(
  db: SupabaseClient,
  instanceId: string,
): Promise<DepartureCandidate | null> {
  const { data, error } = await db
    .from('tour_instances')
    .select(DEPARTURE_SELECT)
    .eq('id', instanceId)
    .maybeSingle();
  if (error) throw new Error(`fetchDeparture: ${error.message}`);
  return (data as unknown as DepartureCandidate | null) ?? null;
}

export async function fetchDepartureBookings(
  db: SupabaseClient,
  instanceId: string,
): Promise<ChargeableBooking[]> {
  const { data, error } = await db
    .from('bookings')
    .select(BOOKING_SELECT)
    .eq('tour_instance_id', instanceId)
    .in('status', [BookingState.PendingMinimum, BookingState.PendingPayment])
    // Solo el flujo diferido: una reserva del cobro inmediato también puede estar
    // `pending_payment` con su intent vivo, y soltárselo sería cancelarle el pago al turista
    // que está pagando en ese momento.
    .not('payment_method_id', 'is', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`fetchDepartureBookings: ${error.message}`);
  return data ?? [];
}

/** Intent vigente de una reserva: el pago `pending` que dejó el intento en curso. */
export async function fetchPendingIntent(
  db: SupabaseClient,
  bookingId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('payments')
    .select('external_payment_id')
    .eq('booking_id', bookingId)
    .eq('status', PaymentRowState.Pending)
    .maybeSingle<{ external_payment_id: string }>();
  if (error) throw new Error(`fetchPendingIntent: ${error.message}`);
  return data?.external_payment_id ?? null;
}

/** Limpia una marca de claim o de captura que quedó de un proceso muerto (§5.6). */
export async function clearStaleMarks(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db
    .from('bookings')
    .update({ cancel_claimed_at: null, capture_started_at: null })
    .eq('id', bookingId);
  if (error) throw new Error(`clearStaleMarks: ${error.message}`);
}

/**
 * Marca la captura en curso, y solo si la reserva sigue autorizada y sin reclamo de cancelación.
 * Es la mitad del mecanismo de exclusión con el turista: ninguna de las dos operaciones puede
 * sostener un lock de fila mientras habla con OnvoPay.
 */
export async function markCaptureStarted(db: SupabaseClient, bookingId: string): Promise<boolean> {
  const { data, error } = await db
    .from('bookings')
    .update({ capture_started_at: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('status', BookingState.PendingPayment)
    .is('cancel_claimed_at', null)
    // Solo una captura por reserva a la vez: con dos réplicas del worker, sin esto las dos
    // marcarían y las dos llamarían a capturar el mismo intent.
    .is('capture_started_at', null)
    .not('authorized_at', 'is', null)
    .select('id');
  if (error) throw new Error(`markCaptureStarted: ${error.message}`);
  return (data ?? []).length > 0;
}
