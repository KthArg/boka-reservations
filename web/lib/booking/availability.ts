import { createSupabaseServiceClient } from '@/lib/db/supabase-service';

export type AvailabilityResult = {
  available: number;
  canBook: boolean;
};

export type HoldResult = {
  holdId: string;
  expiresAt: string;
};

export async function checkAvailability(
  instanceId: string,
  seats: number,
): Promise<AvailabilityResult> {
  const db = createSupabaseServiceClient();

  const { data: instance, error } = await db
    .from('tour_instances')
    .select('capacity_total, capacity_reserved, status, starts_at')
    .eq('id', instanceId)
    .single();

  if (error || !instance) return { available: 0, canBook: false };

  if (instance.status !== 'available' || new Date(instance.starts_at) <= new Date()) {
    return { available: 0, canBook: false };
  }

  // Cupos ocupados por holds vivos: `active` no expirados MÁS `paying` (pago en curso, sin
  // mirar expires_at). Espeja create_hold_atomic (spec 0025) para que la disponibilidad
  // mostrada no difiera del gate real de creación de hold.
  const now = new Date().toISOString();
  const { data: holds } = await db
    .from('tour_holds')
    .select('held_seats, status, expires_at')
    .eq('tour_instance_id', instanceId)
    .in('status', ['active', 'paying']);

  const heldSeats = (holds ?? [])
    .filter((h) => h.status === 'paying' || h.expires_at > now)
    .reduce((sum, h) => sum + h.held_seats, 0);
  const available = Math.max(0, instance.capacity_total - instance.capacity_reserved - heldSeats);

  return { available, canBook: available >= seats };
}

export async function createHold(
  instanceId: string,
  seats: number,
  sessionToken: string,
): Promise<HoldResult> {
  const db = createSupabaseServiceClient();

  const { data, error } = await db.rpc('create_hold_atomic', {
    p_instance_id: instanceId,
    p_seats: seats,
    p_session: sessionToken,
  });

  if (error) throw new Error(error.message);

  return { holdId: data.id, expiresAt: data.expires_at };
}

export async function releaseHold(holdId: string): Promise<void> {
  const db = createSupabaseServiceClient();

  // Libera un hold `active` o `paying` (spec 0025): si el checkout falla DESPUÉS de pasar el
  // hold a `paying`, el catch de initCheckout igual debe liberarlo (release-expired-holds solo
  // toca `active`, así que sin esto un `paying` huérfano retendría el cupo hasta el reconciliador).
  const { error } = await db
    .from('tour_holds')
    .update({ status: 'released' })
    .eq('id', holdId)
    .in('status', ['active', 'paying']);

  if (error) throw new Error(`Error al liberar hold: ${error.message}`);
}
