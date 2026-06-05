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
 * Reintenta manualmente un reembolso fallido: lo vuelve a 'pending' y resetea
 * los intentos para que el worker lo reprocese. Solo admin/staff; auditado.
 */
export async function retryRefund(refundId: string): Promise<RetryRefundResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user?.userRole) return { ok: false, error: RefundRetryError.Unauthorized };

  const db = createSupabaseServiceClient();
  const { data: refund } = await db
    .from('refunds')
    .select('id, status, booking_id')
    .eq('id', refundId)
    .maybeSingle();

  if (!refund) return { ok: false, error: RefundRetryError.NotFound };
  if (refund.status !== RefundStatus.Failed)
    return { ok: false, error: RefundRetryError.NotFailed };

  const { error } = await db
    .from('refunds')
    .update({ status: RefundStatus.Pending, failure_reason: null, attempts: 0 })
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
