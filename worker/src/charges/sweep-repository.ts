import type { SupabaseClient } from '@supabase/supabase-js';
import type { BatchWindow } from './batch-rotation.js';
import { BookingState, PaymentRowState } from './statuses.js';

// Consultas del barrido de intents no cerrados (spec 0029 §5.9). Alcance: reservas canceladas del
// flujo diferido. Los pagos `failed` del checkout con widget no tienen failed_at ni pasan por acá.
// El cierre se registra por record_intent_closed (charges/rpc.ts), auditado y bajo lock.

export type UnclosedIntent = {
  id: string;
  booking_id: string;
  external_payment_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  failed_at: string | null;
};

export function isPendingRow(intent: UnclosedIntent): boolean {
  return intent.status === PaymentRowState.Pending;
}

/**
 * Intents sin cerrar de reservas diferidas canceladas: filas `failed` dentro de la ventana de
 * cierre, y cualquier fila `pending` (anómala: toda cancelación la pasa a failed) sin límite.
 */
export async function fetchUnclosedIntents(
  db: SupabaseClient,
  sinceIso: string,
  window: BatchWindow,
): Promise<UnclosedIntent[]> {
  const { data, error } = await db
    .from('payments')
    .select(
      'id, booking_id, external_payment_id, amount_cents, currency, status, failed_at, bookings!inner(status, payment_method_id)',
    )
    .eq('bookings.status', BookingState.Cancelled)
    .not('bookings.payment_method_id', 'is', null)
    .is('provider_closed_at', null)
    .or(
      `status.eq.${PaymentRowState.Pending},and(status.eq.${PaymentRowState.Failed},failed_at.gte."${sinceIso}")`,
    )
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(window.from, window.to)
    .returns<UnclosedIntent[]>();

  if (error) throw new Error(`fetch unclosed intents: ${error.message}`);
  return data ?? [];
}

/**
 * Intents `failed` de reservas diferidas canceladas que pasaron la ventana sin cierre: el staff
 * los registra con mark_payment_provider_closed, que exige exactamente estas condiciones.
 */
export async function countUnclosedPastWindow(
  db: SupabaseClient,
  beforeIso: string,
): Promise<number> {
  const { count, error } = await db
    .from('payments')
    .select('id, bookings!inner(status, payment_method_id)', { count: 'exact', head: true })
    .eq('bookings.status', BookingState.Cancelled)
    .not('bookings.payment_method_id', 'is', null)
    .eq('status', PaymentRowState.Failed)
    .is('provider_closed_at', null)
    .lt('failed_at', beforeIso);

  if (error) throw new Error(`count unclosed past window: ${error.message}`);
  return count ?? 0;
}
