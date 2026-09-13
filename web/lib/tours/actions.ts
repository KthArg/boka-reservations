'use server';

import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth/server';
import { UserRole } from '@shared/constants/enums';
import { TourActionError } from '@shared/constants/tours';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { TourFormSchema } from './types';
import type { ActionResult } from './types';
import { detectPricingOverlaps, hasHalfOpenSeasons, hasInvalidSeasonRange } from './validation';
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

  if (hasHalfOpenSeasons(pricing)) {
    return { success: false, errors: { _form: [TourActionError.SeasonDatesIncomplete] } };
  }
  if (hasInvalidSeasonRange(pricing)) {
    return { success: false, errors: { _form: [TourActionError.SeasonRangeInvalid] } };
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
  if (hasHalfOpenSeasons(pricing)) {
    return { success: false, errors: { _form: [TourActionError.SeasonDatesIncomplete] } };
  }
  if (hasInvalidSeasonRange(pricing)) {
    return { success: false, errors: { _form: [TourActionError.SeasonRangeInvalid] } };
  }
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
