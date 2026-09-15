import { z } from 'zod';
import {
  MINIMUM_DECISION_WINDOW_HOURS_MAX,
  MINIMUM_DECISION_WINDOW_HOURS_MIN,
  SettingsActionError,
} from '@shared/constants/settings';
import type { Tables } from '@/types/database';

/** Formulario de `/dashboard/settings` (spec 0029). El rango espeja el CHECK de DB. */
export const BusinessSettingsFormSchema = z.object({
  minimum_decision_window_hours: z.coerce
    .number()
    .int()
    .min(MINIMUM_DECISION_WINDOW_HOURS_MIN)
    .max(MINIMUM_DECISION_WINDOW_HOURS_MAX),
});

export type BusinessSettings = Pick<
  Tables<'business_settings'>,
  'minimum_decision_window_hours' | 'updated_at'
>;

export type SettingsFormResult = { success: true } | { success: false; error: SettingsActionError };
