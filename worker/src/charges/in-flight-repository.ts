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
export type UnpaidCandidate = {
  id: string;
  authorized_at: string | null;
  payments: PendingPaymentRef[];
};

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
    // Una autorización (spec 0033) no es un cobro en vuelo de segundos: vive horas y la resuelve
    // el ciclo del mínimo con su propio plazo. Acá se cancelaría por el plazo de recuperación.
    .is('authorized_at', null)
    .lt('charge_started_at', startedBeforeIso)
    .eq('payments.status', PaymentRowState.Pending)
    .order('charge_started_at', { ascending: true })
    .order('id', { ascending: true })
    .range(window.from, window.to)
    .returns<InFlightCharge[]>();

  if (error) throw new Error(`fetch in-flight charges: ${error.message}`);
  return data ?? [];
}

/**
 * Reservas sin cobrar cuyo plazo de recuperación venció (§5.7). Solo las que fallaron alguna vez:
 * el plazo lo estampa un rechazo, y este job NO está detrás del flag del motor del mínimo, así que
 * sin ese filtro cancelaría reservas que todavía esperan su primer intento (spec 0033 §5.9).
 */
export async function fetchExpiredRecoveries(
  db: SupabaseClient,
  nowIso: string,
  window: BatchWindow,
): Promise<UnpaidCandidate[]> {
  const { data, error } = await db
    .from('bookings')
    .select(`id, authorized_at, ${PENDING_PAYMENT_EMBED}`)
    .eq('status', BookingState.PendingMinimum)
    .gt('charge_attempts', 0)
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
 * En C, resolve-minimum-window y el barrido terminal actúan antes; esto queda como red. Incluye
 * las autorizadas (spec 0033): una retención viva a la hora del tour hay que soltarla, no dejarla
 * ocupando plata del turista hasta que el banco la libere sola.
 */
export async function fetchStartedUnpaid(
  db: SupabaseClient,
  nowIso: string,
  window: BatchWindow,
): Promise<UnpaidCandidate[]> {
  const { data, error } = await db
    .from('bookings')
    .select(`id, authorized_at, tour_instances!inner(starts_at), ${PENDING_PAYMENT_EMBED}`)
    .or(
      `status.eq.${BookingState.PendingMinimum},and(status.eq.${BookingState.PendingPayment},authorized_at.not.is.null)`,
    )
    .lte('tour_instances.starts_at', nowIso)
    .eq('payments.status', PaymentRowState.Pending)
    .order('id', { ascending: true })
    .range(window.from, window.to)
    .returns<UnpaidCandidate[]>();

  if (error) throw new Error(`fetch started unpaid: ${error.message}`);
  return data ?? [];
}
