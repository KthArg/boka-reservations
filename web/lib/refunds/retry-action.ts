'use server';

import { revalidatePath } from 'next/cache';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { writeAuditLog } from '@/lib/audit/log';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import { AuditAction, AuditEntityType, actorTypeForRole } from '@shared/constants/audit';
import { RefundStatus } from '@shared/constants/refunds';
import { RefundRetryError } from '@shared/constants/cancellations';

export type RetryRefundResult = { ok: true } | { ok: false; error: RefundRetryError };

const ADMIN_DETAIL_BASE = '/dashboard/bookings';

/**
 * Reintenta manualmente un reembolso fallido. Solo admin/staff; auditado.
 *
 * Anti doble-reembolso (spec 0028, A4): si el refund YA tiene external_refund_id
 * (existe en OnvoPay: markProcessing fallido, processing-stale o timeout), NO se
 * re-crea — se devuelve a 'processing' para que el worker VERIFIQUE el existente
 * (GET) y asiente su estado real. Solo un refund sin id externo vuelve a 'pending'
 * para un nuevo POST.
 */
export async function retryRefund(refundId: string): Promise<RetryRefundResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user?.userRole) return { ok: false, error: RefundRetryError.Unauthorized };

  const db = createSupabaseServiceClient();
  const { data: refund } = await db
    .from('refunds')
    .select('id, status, booking_id, external_refund_id')
    .eq('id', refundId)
    .maybeSingle();

  if (!refund) return { ok: false, error: RefundRetryError.NotFound };
  if (refund.status !== RefundStatus.Failed)
    return { ok: false, error: RefundRetryError.NotFailed };

  const target = refund.external_refund_id
    ? { status: RefundStatus.Processing, failure_reason: null }
    : { status: RefundStatus.Pending, failure_reason: null, attempts: 0 };

  const { error } = await db
    .from('refunds')
    .update(target)
    .eq('id', refundId)
    .eq('status', RefundStatus.Failed);

  if (error) return { ok: false, error: RefundRetryError.WriteFailed };

  await writeAuditLog(db, {
    actorType: actorTypeForRole(user.userRole),
    actorId: user.id,
    action: AuditAction.RefundRetried,
    entityType: AuditEntityType.Refund,
    entityId: refundId,
    metadata: { booking_id: refund.booking_id },
  });

  revalidatePath(`${ADMIN_DETAIL_BASE}/${refund.booking_id}`);
  return { ok: true };
}
