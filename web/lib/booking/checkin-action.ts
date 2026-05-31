'use server';

import { revalidatePath } from 'next/cache';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { ADMIN_PANEL_ROLES, CheckInAction, CheckInError } from '@shared/constants/bookings';
import { BookingStatus } from '@shared/constants/enums';

export type CheckInResult = { ok: true } | { ok: false; error: CheckInError };

const LIST_PATH = '/dashboard/bookings';

/**
 * Marca o revierte el check-in de una reserva confirmada.
 * - Solo admin/staff.
 * - Idempotente: marcar no pisa un timestamp existente (UPDATE condicionado
 *   a checked_in_at IS NULL); revertir lo limpia.
 */
export async function toggleCheckIn(
  bookingId: string,
  action: CheckInAction,
): Promise<CheckInResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return { ok: false, error: CheckInError.Unauthorized };

  const db = createSupabaseServiceClient();
  const { data: booking } = await db
    .from('bookings')
    .select('status')
    .eq('id', bookingId)
    .maybeSingle();

  if (!booking) return { ok: false, error: CheckInError.NotFound };
  if (booking.status !== BookingStatus.Confirmed) {
    return { ok: false, error: CheckInError.NotConfirmed };
  }

  if (action === CheckInAction.CheckIn) {
    await db
      .from('bookings')
      .update({ checked_in_at: new Date().toISOString(), checked_in_by: user.id })
      .eq('id', bookingId)
      .is('checked_in_at', null);
  } else {
    await db
      .from('bookings')
      .update({ checked_in_at: null, checked_in_by: null })
      .eq('id', bookingId);
  }

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${bookingId}`);
  return { ok: true };
}
