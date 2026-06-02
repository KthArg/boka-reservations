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
};

/** Reembolsos activos (encolados o en proceso) que el job debe atender. */
export async function fetchActiveRefunds(db: SupabaseClient): Promise<RefundRow[]> {
  const { data, error } = await db
    .from('refunds')
    .select(
      'id, booking_id, payment_id, external_refund_id, amount_cents, currency, status, attempts',
    )
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)
    .returns<RefundRow[]>();

  if (error) throw new Error(`fetch refunds: ${error.message}`);
  return data ?? [];
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

/** Incrementa intentos de creación (fallo transitorio del POST). */
export async function bumpAttempts(
  db: SupabaseClient,
  id: string,
  attempts: number,
): Promise<void> {
  await db.from('refunds').update({ attempts }).eq('id', id);
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

/** Cierra el refund como acreditado: marca payment/booking, encola el email y audita. */
export async function markSucceeded(db: SupabaseClient, refund: RefundRow): Promise<void> {
  await db.from('refunds').update({ status: 'succeeded' }).eq('id', refund.id);
  await db.from('payments').update({ status: 'refunded' }).eq('id', refund.payment_id);
  await db.from('bookings').update({ status: 'refunded' }).eq('id', refund.booking_id);

  const { data: booking } = await db
    .from('bookings')
    .select('customer_email, locale')
    .eq('id', refund.booking_id)
    .maybeSingle();

  if (booking) {
    await db.from('notifications').upsert(
      {
        booking_id: refund.booking_id,
        kind: 'refund_confirmation',
        recipient_email: booking.customer_email,
        locale: booking.locale,
        scheduled_for: new Date().toISOString(),
      },
      { onConflict: 'booking_id,kind', ignoreDuplicates: true },
    );
  }

  await writeAudit(db, 'refund.succeeded', refund.booking_id, {
    amount_cents: refund.amount_cents,
  });
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
