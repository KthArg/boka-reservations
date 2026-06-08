import type { SupabaseClient } from '@supabase/supabase-js';

const BATCH_SIZE = 20;

export type RefundRow = {
  id: string;
  booking_id: string;
  payment_id: string;
  external_refund_id: string | null;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  attempts: number;
  created_at: string;
};

/** Reembolsos activos (encolados o en proceso) que el job debe atender. */
export async function fetchActiveRefunds(db: SupabaseClient): Promise<RefundRow[]> {
  const { data, error } = await db
    .from('refunds')
    .select(
      'id, booking_id, payment_id, external_refund_id, amount_cents, currency, status, attempts, created_at',
    )
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)
    .returns<RefundRow[]>();

  if (error) throw new Error(`fetch refunds: ${error.message}`);
  return data ?? [];
}

/**
 * Reclama una fila 'pending' pasándola a 'processing' de forma atómica
 * (single-flight). El UPDATE condicional `WHERE status='pending'` garantiza que
 * si dos ciclos del worker se solapan, solo uno afecta la fila: el otro recibe
 * 0 filas y devuelve false, y NO debe llamar a OnvoPay. Así se evita el doble
 * POST /refunds (doble reembolso), que el spec exigía prevenir y la versión
 * previa no hacía (posteaba antes de reclamar).
 */
export async function claimForProcessing(
  db: SupabaseClient,
  id: string,
  attempts: number,
): Promise<boolean> {
  const { data, error } = await db
    .from('refunds')
    .update({ status: 'processing', attempts })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');

  if (error) throw new Error(`claim refund: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Devuelve una fila reclamada a 'pending' tras un fallo transitorio del POST. */
export async function releaseClaim(
  db: SupabaseClient,
  id: string,
  attempts: number,
): Promise<void> {
  await db.from('refunds').update({ status: 'pending', attempts }).eq('id', id);
}

export async function loadPaymentIntentId(
  db: SupabaseClient,
  paymentId: string,
): Promise<string | null> {
  const { data } = await db
    .from('payments')
    .select('external_payment_id')
    .eq('id', paymentId)
    .maybeSingle<{ external_payment_id: string }>();
  return data?.external_payment_id ?? null;
}

/** Marca el refund como en proceso tras crearlo en OnvoPay. */
export async function markProcessing(
  db: SupabaseClient,
  id: string,
  externalRefundId: string,
  attempts: number,
): Promise<void> {
  await db
    .from('refunds')
    .update({ status: 'processing', external_refund_id: externalRefundId, attempts })
    .eq('id', id);
}

async function writeAudit(
  db: SupabaseClient,
  action: string,
  bookingId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.from('audit_logs').insert({
    actor_type: 'system',
    action,
    entity_type: 'booking',
    entity_id: bookingId,
    metadata,
  });
}

/**
 * Cierra el refund como acreditado de forma ATÓMICA vía la función DB
 * `settle_refund`: en una sola transacción marca refund/payment/booking,
 * encola el email de reembolso y audita. Reemplaza la secuencia previa de
 * UPDATEs sueltos, que dejaba estados inconsistentes si el worker caía a mitad.
 */
export async function markSucceeded(db: SupabaseClient, refund: RefundRow): Promise<void> {
  const { error } = await db.rpc('settle_refund', { p_refund_id: refund.id });
  if (error) throw new Error(`settle refund: ${error.message}`);
}

/** Cierra el refund como fallido para retry manual; no toca el booking. */
export async function markFailed(
  db: SupabaseClient,
  refund: RefundRow,
  failureReason: string,
  attempts: number,
): Promise<void> {
  await db
    .from('refunds')
    .update({ status: 'failed', failure_reason: failureReason, attempts })
    .eq('id', refund.id);
  await writeAudit(db, 'refund.failed', refund.booking_id, { reason: failureReason });
}
