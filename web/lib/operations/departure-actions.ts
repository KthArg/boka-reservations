'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import { DEPARTURES_PATH } from '@shared/constants/departures';
import {
  CancelDepartureOutcome,
  DepartureCancellationReason,
  KeepDepartureOutcome,
  OperationError,
} from '@shared/constants/operations';
import type { OperationResult } from './types';

// Acciones sobre una salida (spec 0035): cancelarla con un motivo o mantenerla bajo el mínimo.
// Admin y staff. La base valida de nuevo el actor y serializa con el proceso del mínimo.

const CancelSchema = z.object({
  instanceId: z.string().uuid(),
  reason: z.enum([
    DepartureCancellationReason.Minimum,
    DepartureCancellationReason.Weather,
    DepartureCancellationReason.Safety,
    DepartureCancellationReason.ForceMajeure,
    DepartureCancellationReason.Other,
  ]),
});

const CANCEL_ERRORS: Partial<Record<string, OperationError>> = {
  [CancelDepartureOutcome.AlreadyCancelled]: OperationError.AlreadyDone,
  [CancelDepartureOutcome.AlreadyResolved]: OperationError.AlreadyDone,
  [CancelDepartureOutcome.AlreadyStarted]: OperationError.AlreadyStarted,
  [CancelDepartureOutcome.MinimumTooLate]: OperationError.MinimumTooLate,
  [CancelDepartureOutcome.CaptureInProgress]: OperationError.CaptureInProgress,
};

export async function cancelDepartureAction(
  instanceId: string,
  reason: string,
): Promise<OperationResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return { ok: false, error: OperationError.Unauthorized };

  const parsed = CancelSchema.safeParse({ instanceId, reason });
  if (!parsed.success) return { ok: false, error: OperationError.Invalid };

  const { data, error } = await createSupabaseServiceClient().rpc('cancel_departure', {
    p_instance_id: parsed.data.instanceId,
    p_reason: parsed.data.reason,
    p_actor_id: user.id,
  });
  if (error) {
    console.error('[operations] cancel_departure:', error.message, parsed.data.instanceId);
    return { ok: false, error: OperationError.WriteFailed };
  }
  if (data !== CancelDepartureOutcome.Cancelled) {
    return { ok: false, error: CANCEL_ERRORS[data] ?? OperationError.WriteFailed };
  }

  revalidatePath(DEPARTURES_PATH);
  return { ok: true };
}

const KeepSchema = z.object({ instanceId: z.string().uuid() });

export async function keepDepartureAction(instanceId: string): Promise<OperationResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return { ok: false, error: OperationError.Unauthorized };

  const parsed = KeepSchema.safeParse({ instanceId });
  if (!parsed.success) return { ok: false, error: OperationError.Invalid };

  const { data, error } = await createSupabaseServiceClient().rpc('keep_departure', {
    p_instance_id: parsed.data.instanceId,
    p_actor_id: user.id,
  });
  if (error) {
    console.error('[operations] keep_departure:', error.message, parsed.data.instanceId);
    return { ok: false, error: OperationError.WriteFailed };
  }
  if (data === KeepDepartureOutcome.DeferredFlow) {
    return { ok: false, error: OperationError.DeferredFlow };
  }
  if (data !== KeepDepartureOutcome.Resolved)
    return { ok: false, error: OperationError.AlreadyDone };

  revalidatePath(DEPARTURES_PATH);
  return { ok: true };
}
