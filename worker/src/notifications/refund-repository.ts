import type { SupabaseClient } from '@supabase/supabase-js';
import type { TransferChannel } from './types.js';

// Último reembolso de una reserva, para los correos de cancelación, reembolso y transferencia.

export type LatestRefund = {
  amountCents: number;
  currency: string;
  status: string;
  /** Canal de la devolución por transferencia (spec 0035); null si fue a la tarjeta. */
  transferChannel: TransferChannel | null;
};

type RefundRow = {
  amount_cents: number;
  currency: string;
  status: string;
  transfer_channel: TransferChannel | null;
};

/** Último reembolso de una reserva (cualquier estado). null si no hay. */
export async function loadLatestRefund(
  db: SupabaseClient,
  bookingId: string,
): Promise<LatestRefund | null> {
  const { data, error } = await db
    .from('refunds')
    .select('amount_cents, currency, status, transfer_channel')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<RefundRow>();

  if (error) throw new Error(`load refund: ${error.message}`);
  return data
    ? {
        amountCents: data.amount_cents,
        currency: data.currency,
        status: data.status,
        transferChannel: data.transfer_channel,
      }
    : null;
}
