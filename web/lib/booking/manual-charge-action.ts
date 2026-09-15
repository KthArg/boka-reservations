'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { env } from '@/lib/env';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import { chargeBookingManually } from './manual-charge';
import { ManualChargeOutcome, type ManualChargeOutcomeValue } from './manual-charge-outcomes';

// Server action del cobro manual (spec 0029 §5.11). Solo admin y staff; el inicio del cobro queda
// auditado con el actor por charge_booking_start.

const ADMIN_DETAIL_BASE = '/dashboard/bookings';
const BookingIdSchema = z.string().uuid();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

export async function chargeBookingAction(
  bookingId: string,
): Promise<{ outcome: ManualChargeOutcomeValue }> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch((err: unknown) => {
    // Sin sesión o sin rol, pero también una caída del auth: queda registrado cuál fue.
    console.error('[manual-charge] auth:', errorMessage(err));
    return null;
  });
  if (!user?.userRole) return { outcome: ManualChargeOutcome.Unauthorized };
  if (!BookingIdSchema.safeParse(bookingId).success) {
    return { outcome: ManualChargeOutcome.NotChargeable };
  }

  let outcome: ManualChargeOutcomeValue;
  try {
    const db = createSupabaseServiceClient();
    outcome = await chargeBookingManually(db, bookingId, user.id, env.APP_URL);
  } catch (err) {
    console.error('[manual-charge]', errorMessage(err));
    outcome = ManualChargeOutcome.Failed;
  }

  revalidatePath(`${ADMIN_DETAIL_BASE}/${bookingId}`);
  return { outcome };
}
