'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import {
  DEPARTURES_PATH,
  DepartureDecision,
  DepartureDecisionError,
  DepartureResolution,
  DepartureResolutionOutcome,
  type DepartureDecisionValue,
} from '@shared/constants/departures';

// Decisión del staff sobre una salida que no alcanzó el mínimo (spec 0033 §5.5). Confirmar la
// devuelve al ciclo: en la corrida siguiente el worker autoriza y captura. Cancelar cancela la
// salida, cancela sus reservas sin cobro y reembolsa el 100 % de las cobradas.

export type DepartureDecisionResult = { ok: true } | { ok: false; error: DepartureDecisionError };

/**
 * Una server action es un endpoint POST invocable desde afuera y el tipo del argumento no existe
 * en runtime: sin esto, cualquier valor distinto de `confirm` caería en la rama que cancela la
 * salida entera y reembolsa lo cobrado.
 */
const DecisionSchema = z.object({
  instanceId: z.string().uuid(),
  decision: z.enum([DepartureDecision.Confirm, DepartureDecision.Cancel]),
});

export async function decideDeparture(
  instanceId: string,
  decision: DepartureDecisionValue,
): Promise<DepartureDecisionResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return { ok: false, error: DepartureDecisionError.Unauthorized };

  const parsed = DecisionSchema.safeParse({ instanceId, decision });
  if (!parsed.success) return { ok: false, error: DepartureDecisionError.NotResolvable };

  const resolution =
    parsed.data.decision === DepartureDecision.Confirm
      ? DepartureResolution.StaffConfirmed
      : DepartureResolution.StaffCancelled;

  const db = createSupabaseServiceClient();
  const { data, error } = await db.rpc('resolve_departure_minimum', {
    p_instance_id: parsed.data.instanceId,
    p_resolution: resolution,
    // Lo exige tour_instances_minimum_actor_check: una resolución del staff sin actor no valida.
    p_actor_id: user.id,
  });
  if (error) return { ok: false, error: DepartureDecisionError.WriteFailed };
  if (data === DepartureResolutionOutcome.AlreadyResolved) {
    // Otra persona (o la red terminal del worker) decidió primero: la pantalla se recarga.
    return { ok: false, error: DepartureDecisionError.AlreadyResolved };
  }
  if (data === DepartureResolutionOutcome.CaptureInProgress) {
    // El worker está cobrando una reserva de esta salida: resolver ahora podría cancelarla con
    // la plata ya cobrada. La marca vence a los 15 minutos.
    return { ok: false, error: DepartureDecisionError.CaptureInProgress };
  }
  if (data !== DepartureResolutionOutcome.Resolved) {
    return { ok: false, error: DepartureDecisionError.NotResolvable };
  }

  revalidatePath(DEPARTURES_PATH);
  return { ok: true };
}
