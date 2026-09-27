import { z } from 'zod';
import {
  DEFAULT_CHARGE_LEAD_HOURS_MAX,
  DEFAULT_CHARGE_LEAD_HOURS_MIN,
  MINIMUM_DECISION_WINDOW_HOURS_MAX,
  MINIMUM_DECISION_WINDOW_HOURS_MIN,
  SettingsActionError,
} from '@shared/constants/settings';
import type { Tables } from '@/types/database';

/** Formulario de `/dashboard/settings` (specs 0029 y 0033). Los rangos espejan los CHECK de DB. */
export const BusinessSettingsFormSchema = z.object({
  minimum_decision_window_hours: z.coerce
    .number()
    .int()
    .min(MINIMUM_DECISION_WINDOW_HOURS_MIN)
    .max(MINIMUM_DECISION_WINDOW_HOURS_MAX),
  default_charge_lead_hours: z.coerce
    .number()
    .int()
    .min(DEFAULT_CHARGE_LEAD_HOURS_MIN)
    .max(DEFAULT_CHARGE_LEAD_HOURS_MAX),
});

export type BusinessSettingsForm = z.infer<typeof BusinessSettingsFormSchema>;

export type BusinessSettings = Pick<
  Tables<'business_settings'>,
  'minimum_decision_window_hours' | 'default_charge_lead_hours' | 'updated_at'
>;

export type SettingsFormResult = { success: true } | { success: false; error: SettingsActionError };
