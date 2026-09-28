'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { DEPARTURES_PATH } from '@shared/constants/departures';
import {
  OperationError,
  RescheduleOutcome,
  ReviewDecision,
  ReviewDecisionOutcome,
} from '@shared/constants/operations';
import { ADMIN_PANEL_ROLES, BOOKINGS_ADMIN_PATH } from '@shared/constants/bookings';
import type { OperationResult } from './types';

// Acciones sobre una reserva (spec 0035): decidir una reserva en revisión y cambiarla de fecha.
// Admin y staff. Las funciones SQL validan el actor, bloquean la salida y la reserva, y auditan.

function revalidateBooking(bookingId: string): void {
  revalidatePath(BOOKINGS_ADMIN_PATH);
  revalidatePath(`${BOOKINGS_ADMIN_PATH}/${bookingId}`);
  revalidatePath(DEPARTURES_PATH);
}

const DecisionSchema = z.object({
  bookingId: z.string().uuid(),
  decision: z.enum([ReviewDecision.Refund, ReviewDecision.NoRefund]),
});

export async function decideReviewAction(
  bookingId: string,
  decision: string,
): Promise<OperationResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return { ok: false, error: OperationError.Unauthorized };

  const parsed = DecisionSchema.safeParse({ bookingId, decision });
  if (!parsed.success) return { ok: false, error: OperationError.Invalid };

  const fn =
    parsed.data.decision === ReviewDecision.Refund
      ? 'refund_reviewed_booking'
      : 'close_reviewed_booking_without_refund';
  const { data, error } = await createSupabaseServiceClient().rpc(fn, {
    p_booking_id: parsed.data.bookingId,
    p_actor_id: user.id,
  });
  if (error) {
    console.error(`[operations] ${fn}:`, error.message, parsed.data.bookingId);
    return { ok: false, error: OperationError.WriteFailed };
  }
  if (data === ReviewDecisionOutcome.NotUnderReview) {
    return { ok: false, error: OperationError.NotUnderReview };
  }

  revalidateBooking(parsed.data.bookingId);
  return { ok: true };
}

const RescheduleSchema = z.object({
  bookingId: z.string().uuid(),
  targetInstanceId: z.string().uuid(),
});

const RESCHEDULE_ERRORS: Partial<Record<string, OperationError>> = {
  [RescheduleOutcome.NoCapacity]: OperationError.NoCapacity,
  [RescheduleOutcome.TargetUnavailable]: OperationError.TargetUnavailable,
  [RescheduleOutcome.DifferentTour]: OperationError.Invalid,
  [RescheduleOutcome.SameInstance]: OperationError.Invalid,
  [RescheduleOutcome.NotConfirmed]: OperationError.NotReschedulable,
  [RescheduleOutcome.SourceStarted]: OperationError.NotReschedulable,
};

export async function rescheduleBookingAction(
  bookingId: string,
  targetInstanceId: string,
): Promise<OperationResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return { ok: false, error: OperationError.Unauthorized };

  const parsed = RescheduleSchema.safeParse({ bookingId, targetInstanceId });
  if (!parsed.success) return { ok: false, error: OperationError.Invalid };

  const { data, error } = await createSupabaseServiceClient().rpc('reschedule_booking', {
    p_booking_id: parsed.data.bookingId,
    p_target_instance_id: parsed.data.targetInstanceId,
    p_actor_id: user.id,
  });
  if (error) {
    console.error('[operations] reschedule_booking:', error.message, parsed.data.bookingId);
    return { ok: false, error: OperationError.WriteFailed };
  }
  if (data !== RescheduleOutcome.Rescheduled) {
    return { ok: false, error: RESCHEDULE_ERRORS[data] ?? OperationError.WriteFailed };
  }

  revalidateBooking(parsed.data.bookingId);
  return { ok: true };
}
