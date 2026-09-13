'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/server';
import { UserRole, TourStatus, InstanceStatus, BookingStatus } from '@shared/constants/enums';
import { TourActionError } from '@shared/constants/tours';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';

export type ArchiveResult = { ok: true } | { ok: false; error: string };

/**
 * Archiva un tour dejando sus salidas coherentes (spec 0028, B12): con reservas activas
 * en salidas futuras se bloquea; sin ellas, las salidas futuras `available` pasan a
 * `cancelled` (dejan de listarse y de poder reservarse). Usa el service client tras el
 * guard de rol: las instancias las administra el sistema, no hay RLS de escritura admin.
 */
export async function archiveTour(id: string): Promise<ArchiveResult> {
  await requireRole(UserRole.Admin);
  const db = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  if (await hasActiveFutureBookings(db, id, nowIso)) {
    return { ok: false, error: TourActionError.ArchiveHasBookings };
  }

  const { data: cancelled, error: instErr } = await db
    .from('tour_instances')
    .update({ status: InstanceStatus.Cancelled })
    .eq('tour_id', id)
    .eq('status', InstanceStatus.Available)
    .gte('starts_at', nowIso)
    .select('id');
  if (instErr) return { ok: false, error: TourActionError.ArchiveFailed };

  // Re-chequeo anti-TOCTOU (review pre-PR): un checkout concurrente pudo crear una
  // reserva entre el chequeo y la cancelación. Si apareció, se revierte y se rechaza.
  // La ventana residual (reserva creada DESPUÉS de este re-chequeo) la cubre el flujo
  // normal: la instancia ya está `cancelled` y create_hold_atomic la rechaza.
  if (await hasActiveFutureBookings(db, id, nowIso)) {
    const ids = (cancelled ?? []).map((r) => r.id);
    if (ids.length > 0) {
      await db.from('tour_instances').update({ status: InstanceStatus.Available }).in('id', ids);
    }
    return { ok: false, error: TourActionError.ArchiveHasBookings };
  }

  const { error } = await db.from('tours').update({ status: TourStatus.Archived }).eq('id', id);
  if (error) return { ok: false, error: TourActionError.ArchiveFailed };

  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function reactivateTour(id: string): Promise<ArchiveResult> {
  await requireRole(UserRole.Admin);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('tours').update({ status: TourStatus.Active }).eq('id', id);
  if (error) return { ok: false, error: TourActionError.ArchiveFailed };
  revalidatePath('/', 'layout');
  return { ok: true };
}

async function hasActiveFutureBookings(
  db: ReturnType<typeof createSupabaseServiceClient>,
  tourId: string,
  nowIso: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('bookings')
    .select('id, tour_instances!inner(tour_id, starts_at)')
    .in('status', [BookingStatus.PendingPayment, BookingStatus.Confirmed])
    .eq('tour_instances.tour_id', tourId)
    .gte('tour_instances.starts_at', nowIso)
    .limit(1);
  // Ante error de lectura se responde "hay reservas": el archivado falla cerrado.
  if (error) return true;
  return (data?.length ?? 0) > 0;
}
