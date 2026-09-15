import type { SupabaseClient } from '@supabase/supabase-js';
import type { BatchWindow } from './batch-rotation.js';
import { BookingState, PaymentRowState } from './statuses.js';

// Consultas de watch-charges (spec 0029 §5.5, §5.7, §5.9). Solo lecturas: las transiciones van
// por charges/rpc.ts. Cada una pagina por ventana (batch-rotation.ts) con orden total (id como
// desempate) para que las ventanas no se solapen.

// Solo la fila `pending`: el índice único de …043 garantiza a lo sumo una.
const PENDING_PAYMENT_EMBED = 'payments(external_payment_id, amount_cents, currency)';

export type PendingPaymentRef = {
  external_payment_id: string;
  amount_cents: number;
  currency: string;
};

export type InFlightCharge = {
  id: string;
  charge_started_at: string;
  awaiting_action_until: string | null;
  recovery_deadline: string | null;
  tour_instance: { starts_at: string };
  payments: PendingPaymentRef[];
};

/** Reserva sin cobrar a cancelar, con el intent que conserve de un rechazo registrado. */
export type UnpaidCandidate = { id: string; payments: PendingPaymentRef[] };

/**
 * Cobros en vuelo iniciados antes del umbral. Los más recientes siguen en manos de quien los
 * inició (worker o panel), que puede estar esperando la respuesta del confirm.
 */
export async function fetchInFlightCharges(
  db: SupabaseClient,
  startedBeforeIso: string,
  window: BatchWindow,
): Promise<InFlightCharge[]> {
  const { data, error } = await db
    .from('bookings')
    .select(
      `id, charge_started_at, awaiting_action_until, recovery_deadline, tour_instance:tour_instances!inner(starts_at), ${PENDING_PAYMENT_EMBED}`,
    )
    .eq('status', BookingState.PendingPayment)
    .not('charge_started_at', 'is', null)
    .lt('charge_started_at', startedBeforeIso)
    .eq('payments.status', PaymentRowState.Pending)
    .order('charge_started_at', { ascending: true })
    .order('id', { ascending: true })
    .range(window.from, window.to)
    .returns<InFlightCharge[]>();

  if (error) throw new Error(`fetch in-flight charges: ${error.message}`);
  return data ?? [];
}

/** Reservas sin cobrar cuyo plazo de recuperación venció (§5.7). */
export async function fetchExpiredRecoveries(
  db: SupabaseClient,
  nowIso: string,
  window: BatchWindow,
): Promise<UnpaidCandidate[]> {
  const { data, error } = await db
    .from('bookings')
    .select(`id, ${PENDING_PAYMENT_EMBED}`)
    .eq('status', BookingState.PendingMinimum)
    .lte('recovery_deadline', nowIso)
    .eq('payments.status', PaymentRowState.Pending)
    .order('recovery_deadline', { ascending: true })
    .order('id', { ascending: true })
    .range(window.from, window.to)
    .returns<UnpaidCandidate[]>();

  if (error) throw new Error(`fetch expired recoveries: ${error.message}`);
  return data ?? [];
}

/**
 * Red terminal (§5.9): reservas sin cobrar de salidas que ya empezaron, estén o no disparadas.
 * En C, resolve-minimum-window y el barrido terminal actúan antes; esto queda como red.
 */
export async function fetchStartedUnpaid(
  db: SupabaseClient,
  nowIso: string,
  window: BatchWindow,
): Promise<UnpaidCandidate[]> {
  const { data, error } = await db
    .from('bookings')
    .select(`id, tour_instances!inner(starts_at), ${PENDING_PAYMENT_EMBED}`)
    .eq('status', BookingState.PendingMinimum)
    .lte('tour_instances.starts_at', nowIso)
    .eq('payments.status', PaymentRowState.Pending)
    .order('id', { ascending: true })
    .range(window.from, window.to)
    .returns<UnpaidCandidate[]>();

  if (error) throw new Error(`fetch started unpaid: ${error.message}`);
  return data ?? [];
}
