'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/server';
import { UserRole } from '@shared/constants/enums';
import { SettingsActionError } from '@shared/constants/settings';
import { updateSettings } from './repository';
import { BusinessSettingsFormSchema } from './types';
import type { SettingsFormResult } from './types';

const SETTINGS_PATH = '/dashboard/settings';

export async function updateBusinessSettings(
  _prev: SettingsFormResult | null,
  formData: FormData,
): Promise<SettingsFormResult> {
  const admin = await requireRole(UserRole.Admin).catch(() => null);
  if (!admin) return { success: false, error: SettingsActionError.Unauthorized };

  const parsed = BusinessSettingsFormSchema.safeParse({
    minimum_decision_window_hours: formData.get('minimum_decision_window_hours'),
    default_charge_lead_hours: formData.get('default_charge_lead_hours'),
  });
  if (!parsed.success) {
    // Un solo error por respuesta (el formulario lo muestra arriba del botón), pero distinguido
    // por campo: el rango de cada uno se explica con su propio mensaje.
    const invalid = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      error: invalid.minimum_decision_window_hours
        ? SettingsActionError.WindowOutOfRange
        : SettingsActionError.LeadHoursOutOfRange,
    };
  }

  const updated = await updateSettings(parsed.data, admin.id);
  if (!updated) return { success: false, error: SettingsActionError.UpdateFailed };

  revalidatePath(SETTINGS_PATH);
  return { success: true };
}
