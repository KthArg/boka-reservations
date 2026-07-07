'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth/server';
import { UserRole, TourStatus, InstanceStatus, BookingStatus } from '@shared/constants/enums';
import { TourActionError } from '@shared/constants/tours';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { TourFormSchema } from './types';
import type { ActionResult } from './types';
import { detectPricingOverlaps } from './validation';
import { slugExists } from './repository';
import { parseTourFields } from './parse';
import { mapPricing, mapSchedules } from './map';
import { reconcileRows, writeErrorCode } from './reconcile';

async function guardAdmin(): Promise<ActionResult | null> {
  try {
    await requireRole(UserRole.Admin);
    return null;
  } catch {
    return { success: false, errors: { _form: [TourActionError.Unauthorized] } };
  }
}

export async function createTour(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const guard = await guardAdmin();
  if (guard) return guard;

  const result = TourFormSchema.safeParse(parseTourFields(formData));
  if (!result.success) return { success: false, errors: result.error.flatten().fieldErrors };

  const { pricing, schedules, ...tourFields } = result.data;

  if (await slugExists(tourFields.slug)) {
    return { success: false, errors: { slug: [TourActionError.SlugTaken] } };
  }

  const overlapErrors = detectPricingOverlaps(pricing);
  if (overlapErrors.length > 0) {
    return { success: false, errors: { _form: overlapErrors.map((e) => e.code) } };
  }

  const supabase = await createSupabaseServerClient();
  const { data: tour, error: tourError } = await supabase
    .from('tours')
    .insert({ ...tourFields, cover_image_url: tourFields.cover_image_url ?? null })
    .select('id')
    .single();

  if (tourError || !tour) {
    return { success: false, errors: { _form: [TourActionError.CreateFailed] } };
  }

  const cleanupAndFail = async (code: string): Promise<ActionResult> => {
    await supabase.from('tours').delete().eq('id', tour.id);
    return { success: false, errors: { _form: [code] } };
  };

  if (pricing.length > 0) {
    const { error } = await supabase.from('tour_pricing').insert(mapPricing(pricing, tour.id));
    if (error) return cleanupAndFail(writeErrorCode(error, TourActionError.PricingWriteFailed));
  }

  if (schedules.length > 0) {
    const { error } = await supabase
      .from('tour_schedules')
      .insert(mapSchedules(schedules, tour.id));
    if (error) return cleanupAndFail(TourActionError.SchedulesWriteFailed);
  }

  const locale = await getLocale();
  redirect(`/${locale}/dashboard/tours`);
}

export async function updateTour(
  id: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const guard = await guardAdmin();
  if (guard) return guard;

  const result = TourFormSchema.safeParse(parseTourFields(formData));
  if (!result.success) return { success: false, errors: result.error.flatten().fieldErrors };

  const { pricing, schedules, ...tourFields } = result.data;

  if (await slugExists(tourFields.slug, id)) {
    return { success: false, errors: { slug: [TourActionError.SlugTaken] } };
  }

  // El formulario representa el estado FINAL completo (spec 0028, B1): la validación
  // corre sobre lo enviado, y reconcileRows elimina de DB las filas quitadas antes de
  // upsertear — quitar un precio del form ahora LO ELIMINA (antes quedaba activo).
  const overlapErrors = detectPricingOverlaps(pricing);
  if (overlapErrors.length > 0) {
    return { success: false, errors: { _form: overlapErrors.map((e) => e.code) } };
  }

  const supabase = await createSupabaseServerClient();
  const { error: tourError } = await supabase
    .from('tours')
    .update({ ...tourFields, cover_image_url: tourFields.cover_image_url ?? null })
    .eq('id', id);

  if (tourError) return { success: false, errors: { _form: [TourActionError.UpdateFailed] } };

  const pricingError = await reconcileRows(
    supabase,
    'tour_pricing',
    id,
    mapPricing(pricing, id),
    TourActionError.PricingWriteFailed,
  );
  if (pricingError) return { success: false, errors: { _form: [pricingError] } };

  const schedulesError = await reconcileRows(
    supabase,
    'tour_schedules',
    id,
    mapSchedules(schedules, id),
    TourActionError.SchedulesWriteFailed,
  );
  if (schedulesError) return { success: false, errors: { _form: [schedulesError] } };

  const locale = await getLocale();
  redirect(`/${locale}/dashboard/tours`);
}

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

  const { data: active, error: qErr } = await db
    .from('bookings')
    .select('id, tour_instances!inner(tour_id, starts_at)')
    .in('status', [BookingStatus.PendingPayment, BookingStatus.Confirmed])
    .eq('tour_instances.tour_id', id)
    .gte('tour_instances.starts_at', nowIso)
    .limit(1);
  if (qErr) return { ok: false, error: TourActionError.ArchiveFailed };
  if ((active?.length ?? 0) > 0) {
    return { ok: false, error: TourActionError.ArchiveHasBookings };
  }

  const { error: instErr } = await db
    .from('tour_instances')
    .update({ status: InstanceStatus.Cancelled })
    .eq('tour_id', id)
    .eq('status', InstanceStatus.Available)
    .gte('starts_at', nowIso);
  if (instErr) return { ok: false, error: TourActionError.ArchiveFailed };

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
