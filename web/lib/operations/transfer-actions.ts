'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import {
  OperationError,
  TransferRequestOutcome,
  TransferSettleOutcome,
} from '@shared/constants/operations';
import { TRANSFER_REFERENCE_MAX_LENGTH, TransferChannel } from '@shared/constants/refunds';
import { BOOKINGS_ADMIN_PATH, type OperationResult } from './types';

// Devolución por transferencia o SINPE Móvil (spec 0035; términos, cláusula 8). El operador hace
// la transferencia desde su banco; la plataforma registra el pedido de datos y el comprobante.
// La base rechaza el pedido si OnvoPay todavía puede acreditar a la tarjeta.

function revalidateRefunds(bookingId: string): void {
  revalidatePath(BOOKINGS_ADMIN_PATH);
  revalidatePath(`${BOOKINGS_ADMIN_PATH}/${bookingId}`);
}

const RequestSchema = z.object({
  refundId: z.string().uuid(),
  bookingId: z.string().uuid(),
});

export async function requestTransferAction(
  refundId: string,
  bookingId: string,
): Promise<OperationResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return { ok: false, error: OperationError.Unauthorized };

  const parsed = RequestSchema.safeParse({ refundId, bookingId });
  if (!parsed.success) return { ok: false, error: OperationError.Invalid };

  const { data, error } = await createSupabaseServiceClient().rpc('request_refund_transfer', {
    p_refund_id: parsed.data.refundId,
    p_actor_id: user.id,
  });
  if (error) {
    console.error('[operations] request_refund_transfer:', error.message, parsed.data.refundId);
    return { ok: false, error: OperationError.WriteFailed };
  }
  if (data === TransferRequestOutcome.ProviderMaySettle) {
    return { ok: false, error: OperationError.ProviderMaySettle };
  }
  if (data !== TransferRequestOutcome.Requested) {
    return { ok: false, error: OperationError.AlreadyDone };
  }

  revalidateRefunds(parsed.data.bookingId);
  return { ok: true };
}

/** Hoy en Costa Rica, como `YYYY-MM-DD` (en-CA formatea así). */
function todayInCostaRica(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date());
}

/**
 * La fecha llega como `YYYY-MM-DD` del input de fecha y no puede ser futura. Se guarda al mediodía
 * de Costa Rica, o ahora si ese mediodía todavía no llegó: la base rechaza fechas futuras.
 */
const PaidOnSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => day <= todayInCostaRica())
  .transform((day) => {
    const noon = new Date(`${day}T12:00:00-06:00`);
    return noon.getTime() > Date.now() ? new Date() : noon;
  })
  .refine((date) => !Number.isNaN(date.getTime()));

const SettleSchema = z.object({
  refundId: z.string().uuid(),
  bookingId: z.string().uuid(),
  channel: z.enum([TransferChannel.SinpeMovil, TransferChannel.BankTransfer]),
  reference: z.string().trim().min(1).max(TRANSFER_REFERENCE_MAX_LENGTH),
  paidOn: PaidOnSchema,
});

export async function settleTransferAction(
  _prev: OperationResult | null,
  formData: FormData,
): Promise<OperationResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return { ok: false, error: OperationError.Unauthorized };

  const parsed = SettleSchema.safeParse({
    refundId: formData.get('refundId'),
    bookingId: formData.get('bookingId'),
    channel: formData.get('channel'),
    reference: formData.get('reference'),
    paidOn: formData.get('paidOn'),
  });
  if (!parsed.success) return { ok: false, error: OperationError.Invalid };

  const { data, error } = await createSupabaseServiceClient().rpc('settle_refund_transfer', {
    p_refund_id: parsed.data.refundId,
    p_actor_id: user.id,
    p_channel: parsed.data.channel,
    p_reference: parsed.data.reference,
    p_paid_at: parsed.data.paidOn.toISOString(),
  });
  if (error) {
    console.error('[operations] settle_refund_transfer:', error.message, parsed.data.refundId);
    return { ok: false, error: OperationError.WriteFailed };
  }
  if (data !== TransferSettleOutcome.Settled)
    return { ok: false, error: OperationError.AlreadyDone };

  revalidateRefunds(parsed.data.bookingId);
  return { ok: true };
}
