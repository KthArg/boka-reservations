'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth/server';
import { UserRole, TourStatus } from '@shared/constants/enums';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { TourFormSchema } from './types';
import type { ActionResult, PricingRow, ScheduleRow } from './types';
import { detectPricingOverlaps } from './validation';
import { slugExists } from './repository';
import { parseTourFields } from './parse';

async function guardAdmin(): Promise<ActionResult | null> {
  try {
    await requireRole(UserRole.Admin);
    return null;
  } catch {
    return { success: false, errors: { _form: ['No autorizado.'] } };
  }
}

function mapPricing(pricing: PricingRow[], tourId: string) {
  return pricing.map((p) => ({
    id: p.id,
    tour_id: tourId,
    ticket_type: p.ticket_type,
    price_usd: p.price_usd,
    season_label: p.season_label ?? null,
    valid_from: p.valid_from ?? null,
    valid_until: p.valid_until ?? null,
    active: p.active,
  }));
}

function mapSchedules(schedules: ScheduleRow[], tourId: string) {
  return schedules.map((s) => ({
    id: s.id,
    tour_id: tourId,
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    capacity: s.capacity,
    valid_from: s.valid_from,
    valid_until: s.valid_until ?? null,
    active: s.active,
  }));
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
    return { success: false, errors: { slug: ['Este slug ya está en uso. Elige otro.'] } };
  }

  const overlapErrors = detectPricingOverlaps(pricing);
  if (overlapErrors.length > 0) {
    return { success: false, errors: { _form: overlapErrors.map((e) => e.message) } };
  }

  const supabase = await createSupabaseServerClient();
  const { data: tour, error: tourError } = await supabase
    .from('tours')
    .insert({ ...tourFields, cover_image_url: tourFields.cover_image_url ?? null })
    .select('id')
    .single();

  if (tourError || !tour) {
    return { success: false, errors: { _form: ['Error al crear el tour. Intenta de nuevo.'] } };
  }

  const cleanupAndFail = async (msg: string): Promise<ActionResult> => {
    await supabase.from('tours').delete().eq('id', tour.id);
    return { success: false, errors: { _form: [msg] } };
  };

  if (pricing.length > 0) {
    const { error } = await supabase.from('tour_pricing').insert(mapPricing(pricing, tour.id));
    if (error) return cleanupAndFail('Error al guardar los precios.');
  }

  if (schedules.length > 0) {
    const { error } = await supabase
      .from('tour_schedules')
      .insert(mapSchedules(schedules, tour.id));
    if (error) return cleanupAndFail('Error al guardar los horarios.');
  }

  const locale = await getLocale();
  redirect(`/${locale}/tours`);
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
    return { success: false, errors: { slug: ['Este slug ya está en uso.'] } };
  }

  const overlapErrors = detectPricingOverlaps(pricing);
  if (overlapErrors.length > 0) {
    return { success: false, errors: { _form: overlapErrors.map((e) => e.message) } };
  }

  const supabase = await createSupabaseServerClient();
  const { error: tourError } = await supabase
    .from('tours')
    .update({ ...tourFields, cover_image_url: tourFields.cover_image_url ?? null })
    .eq('id', id);

  if (tourError) return { success: false, errors: { _form: ['Error al actualizar el tour.'] } };

  if (pricing.length > 0) {
    await supabase.from('tour_pricing').upsert(mapPricing(pricing, id));
  }
  if (schedules.length > 0) {
    await supabase.from('tour_schedules').upsert(mapSchedules(schedules, id));
  }

  const locale = await getLocale();
  redirect(`/${locale}/tours`);
}

export async function archiveTour(id: string): Promise<void> {
  await requireRole(UserRole.Admin);
  const supabase = await createSupabaseServerClient();
  await supabase.from('tours').update({ status: TourStatus.Archived }).eq('id', id);
  revalidatePath('/', 'layout');
}

export async function reactivateTour(id: string): Promise<void> {
  await requireRole(UserRole.Admin);
  const supabase = await createSupabaseServerClient();
  await supabase.from('tours').update({ status: TourStatus.Active }).eq('id', id);
  revalidatePath('/', 'layout');
}
