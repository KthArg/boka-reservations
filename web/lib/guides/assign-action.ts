'use server';

import { revalidatePath } from 'next/cache';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import { UserRole } from '@shared/constants/enums';
import { GuideAssignmentError } from '@shared/constants/guides';
import { NotificationKind } from '@shared/constants/notifications';

const DEPARTURES_PATH = '/dashboard/departures';

export type AssignResult = { ok: true } | { ok: false; error: GuideAssignmentError };

/**
 * Asigna un guía a una instancia (reemplaza cualquier asignación previa, regla
 * de un guía por instancia en MVP) y encola el email de asignación una sola vez
 * por (instancia, guía). Solo admin/staff.
 */
export async function assignGuide(instanceId: string, guideId: string): Promise<AssignResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return { ok: false, error: GuideAssignmentError.Unauthorized };

  const db = createSupabaseServiceClient();

  const { data: instance } = await db
    .from('tour_instances')
    .select('id')
    .eq('id', instanceId)
    .maybeSingle();
  if (!instance) return { ok: false, error: GuideAssignmentError.InstanceNotFound };

  const { data: guide } = await db
    .from('users')
    .select('id, role, email, locale')
    .eq('id', guideId)
    .maybeSingle();
  if (!guide || guide.role !== UserRole.Guide) {
    return { ok: false, error: GuideAssignmentError.NotAGuide };
  }

  // Upsert atómico (spec 0028, B9): el UNIQUE de tour_instance_guides(tour_instance_id)
  // (migración …041) garantiza un guía por salida a nivel DB. El delete+insert previo
  // permitía que dos asignaciones concurrentes dejaran dos guías (o ninguna ante fallo
  // parcial); ahora la última escritura gana, en una sola operación.
  const { error: upsertErr } = await db
    .from('tour_instance_guides')
    .upsert(
      { tour_instance_id: instanceId, guide_id: guideId, assigned_by: user.id },
      { onConflict: 'tour_instance_id' },
    );
  if (upsertErr) return { ok: false, error: GuideAssignmentError.WriteFailed };

  const enqueueErr = await enqueueAssignmentEmail(db, instanceId, guide);
  if (enqueueErr) return { ok: false, error: GuideAssignmentError.WriteFailed };

  revalidatePath(DEPARTURES_PATH);
  return { ok: true };
}

/** Quita el guía de una instancia. No envía email (fuera de alcance). Solo admin/staff. */
export async function unassignGuide(instanceId: string): Promise<AssignResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return { ok: false, error: GuideAssignmentError.Unauthorized };

  const db = createSupabaseServiceClient();
  const { error } = await db
    .from('tour_instance_guides')
    .delete()
    .eq('tour_instance_id', instanceId);
  if (error) return { ok: false, error: GuideAssignmentError.WriteFailed };

  revalidatePath(DEPARTURES_PATH);
  return { ok: true };
}

type GuideRow = { id: string; email: string; locale: 'es' | 'en' };

/** Encola el email (idempotente por (instancia, guía)). Devuelve true si algo falló. */
async function enqueueAssignmentEmail(
  db: ReturnType<typeof createSupabaseServiceClient>,
  instanceId: string,
  guide: GuideRow,
): Promise<boolean> {
  const { data: existing, error: selErr } = await db
    .from('notifications')
    .select('id')
    .eq('tour_instance_id', instanceId)
    .eq('guide_id', guide.id)
    .eq('kind', NotificationKind.GuideAssignment)
    .maybeSingle();
  if (selErr) return true;
  if (existing) return false;

  const { error: insErr } = await db.from('notifications').insert({
    kind: NotificationKind.GuideAssignment,
    tour_instance_id: instanceId,
    guide_id: guide.id,
    recipient_email: guide.email,
    locale: guide.locale,
    scheduled_for: new Date().toISOString(),
  });
  return insErr !== null;
}
