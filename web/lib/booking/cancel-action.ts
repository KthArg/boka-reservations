'use server';

import { revalidatePath } from 'next/cache';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { validateBookingToken } from './access-token';
import { cancelBooking, type CancelResult } from './cancel';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import { AuditActorType, actorTypeForRole } from '@shared/constants/audit';
import { CancellationError } from '@shared/constants/cancellations';

const ADMIN_DETAIL_BASE = '/dashboard/bookings';

/**
 * Cancela una reserva desde el flujo self-service del turista. El acceso se
 * valida por el token hasheado del magic link, no por id crudo.
 */
export async function cancelByToken(token: string): Promise<CancelResult> {
  const db = createSupabaseServiceClient();
  const bookingId = await validateBookingToken(db, token);
  if (!bookingId) return { ok: false, error: CancellationError.InvalidToken };

  return cancelBooking(db, { bookingId, actorType: AuditActorType.Tourist });
}

/** Cancela una reserva desde el panel. Solo admin/staff; queda auditado. */
export async function cancelByStaff(bookingId: string): Promise<CancelResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user?.userRole) return { ok: false, error: CancellationError.Unauthorized };

  const db = createSupabaseServiceClient();
  const result = await cancelBooking(db, {
    bookingId,
    actorType: actorTypeForRole(user.userRole),
    actorId: user.id,
  });

  if (result.ok) {
    revalidatePath(ADMIN_DETAIL_BASE);
    revalidatePath(`${ADMIN_DETAIL_BASE}/${bookingId}`);
  }
  return result;
}
