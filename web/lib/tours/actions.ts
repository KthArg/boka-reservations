'use server';

import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth/server';
import { UserRole } from '@shared/constants/enums';
import { MEETING_POINT_LOCKED, TourActionError } from '@shared/constants/tours';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { TourFormSchema } from './types';
import type { ActionResult } from './types';
import {
  detectPricingOverlaps,
  hasHalfOpenSeasons,
  hasInvalidScheduleRange,
  hasInvalidSeasonRange,
  hasUnlabeledSeason,
} from './validation';
import { parseTourFields } from './parse';
import { mapPricing, mapSchedules, mapTourColumns } from './map';
import { reconcileRows } from './reconcile';
import { withdrawOutOfValidity } from './withdraw';

async function guardAdmin(): Promise<ActionResult | null> {
  try {
    await requireRole(UserRole.Admin);
    return null;
  } catch {
    return { success: false, errors: { _form: [TourActionError.Unauthorized] } };
  }
}

/**
 * Guarda un tour. Los tours no se crean ni se borran (spec 0047): los dos fijos se editan acá.
 * Recibe el id y no el `kind` para que los tests lo ejerciten con tours desechables.
 */
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

  // El formulario representa el estado FINAL completo (spec 0028, B1): la validación
  // corre sobre lo enviado, y reconcileRows elimina de DB las filas quitadas antes de
  // upsertear — quitar un precio del form ahora LO ELIMINA (antes quedaba activo).
  if (hasHalfOpenSeasons(pricing)) {
    return { success: false, errors: { _form: [TourActionError.SeasonDatesIncomplete] } };
  }
  if (hasInvalidSeasonRange(pricing)) {
    return { success: false, errors: { _form: [TourActionError.SeasonRangeInvalid] } };
  }
  if (hasUnlabeledSeason(pricing)) {
    return { success: false, errors: { _form: [TourActionError.SeasonLabelRequired] } };
  }
  if (hasInvalidScheduleRange(schedules)) {
    return { success: false, errors: { _form: [TourActionError.ScheduleRangeInvalid] } };
  }
  const overlapErrors = detectPricingOverlaps(pricing);
  if (overlapErrors.length > 0) {
    return { success: false, errors: { _form: overlapErrors.map((e) => e.code) } };
  }

  const supabase = await createSupabaseServerClient();
  const { data: tour, error: tourError } = await supabase
    .from('tours')
    .update(mapTourColumns(tourFields))
    .eq('id', id)
    .select('kind')
    .maybeSingle();

  if (tourError || !tour) {
    // Quien ya reservó conserva el punto de encuentro que aceptó (spec 0035).
    const locked = tourError?.message.includes(MEETING_POINT_LOCKED) ?? false;
    return {
      success: false,
      errors: {
        _form: [locked ? TourActionError.MeetingPointLocked : TourActionError.UpdateFailed],
      },
    };
  }

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

  // Los horarios ya quedaron guardados: si el retiro falla, se informa y volver a guardar lo
  // reintenta (es idempotente).
  const withdrawal = await withdrawOutOfValidity(id);
  if (!withdrawal) {
    return { success: false, errors: { _form: [TourActionError.ScheduleWithdrawFailed] } };
  }
  if (withdrawal.kept > 0) return { success: true, id, ...withdrawal };

  const locale = await getLocale();
  // `saved` muestra el aviso de guardado: la página a la que vuelve es la misma del formulario.
  redirect(`/${locale}/dashboard/tours${tour.kind ? `/${tour.kind}?saved=1` : ''}`);
}
