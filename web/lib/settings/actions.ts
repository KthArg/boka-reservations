'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/server';
import { UserRole } from '@shared/constants/enums';
import { SettingsActionError } from '@shared/constants/settings';
import { updateDecisionWindow } from './repository';
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
  });
  if (!parsed.success) return { success: false, error: SettingsActionError.WindowOutOfRange };

  const updated = await updateDecisionWindow(parsed.data.minimum_decision_window_hours, admin.id);
  if (!updated) return { success: false, error: SettingsActionError.UpdateFailed };

  revalidatePath(SETTINGS_PATH);
  return { success: true };
}
