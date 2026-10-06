'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/server';
import { UserRole } from '@shared/constants/enums';
import { SettingsActionError } from '@shared/constants/settings';
import { updateSettings } from './repository';
import { BusinessSettingsFormSchema } from './types';
import type { SettingsFormResult } from './types';

const SETTINGS_PATH = '/dashboard/settings';

/** Cada campo con su error, en el orden en que se informan (el primero que falla gana). */
const FIELD_ERRORS = [
  ['minimum_decision_window_hours', SettingsActionError.WindowOutOfRange],
  ['default_charge_lead_hours', SettingsActionError.LeadHoursOutOfRange],
  ['booking_cutoff_hours', SettingsActionError.CutoffOutOfRange],
  ['below_minimum_policy', SettingsActionError.PolicyInvalid],
  ['guide_warning_horizon_days', SettingsActionError.GuideHorizonOutOfRange],
] as const;

export async function updateBusinessSettings(
  _prev: SettingsFormResult | null,
  formData: FormData,
): Promise<SettingsFormResult> {
  const admin = await requireRole(UserRole.Admin).catch(() => null);
  if (!admin) return { success: false, error: SettingsActionError.Unauthorized };

  const parsed = BusinessSettingsFormSchema.safeParse({
    minimum_decision_window_hours: formData.get('minimum_decision_window_hours'),
    default_charge_lead_hours: formData.get('default_charge_lead_hours'),
    booking_cutoff_hours: formData.get('booking_cutoff_hours'),
    below_minimum_policy: formData.get('below_minimum_policy'),
    guide_warning_horizon_days: formData.get('guide_warning_horizon_days'),
  });
  if (!parsed.success) {
    // Un solo error por respuesta (el formulario lo muestra arriba del botón), pero distinguido
    // por campo: el rango de cada uno se explica con su propio mensaje.
    const invalid = parsed.error.flatten().fieldErrors;
    const [, error] = FIELD_ERRORS.find(([field]) => invalid[field]) ?? FIELD_ERRORS[0];
    return { success: false, error };
  }

  const updated = await updateSettings(parsed.data, admin.id);
  if (!updated) return { success: false, error: SettingsActionError.UpdateFailed };

  revalidatePath(SETTINGS_PATH);
  return { success: true };
}
