import 'server-only';
import { requireRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { UserRole } from '@shared/constants/enums';

// Retiro de salidas fuera de vigencia al guardar un tour (spec 0044).

export type WithdrawResult = { withdrawn: number; kept: number };

/**
 * Retira las salidas futuras sin nada vivo encima que quedaron fuera de la vigencia de su horario
 * o de un horario desactivado. Corre con el cliente de servicio: la función SQL es privilegiada y
 * valida ella misma que el actor sea un admin activo. `null` si no se pudo.
 */
export async function withdrawOutOfValidity(tourId: string): Promise<WithdrawResult | null> {
  let actorId: string;
  try {
    actorId = (await requireRole(UserRole.Admin)).id;
  } catch {
    return null;
  }
  const { data, error } = await createSupabaseServiceClient().rpc('withdraw_schedule_instances', {
    p_tour_id: tourId,
    p_actor_id: actorId,
  });
  if (error) return null;
  return data as WithdrawResult;
}
