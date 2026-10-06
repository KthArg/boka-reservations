import { z } from 'zod';
import {
  BOOKING_CUTOFF_HOURS_MAX,
  BOOKING_CUTOFF_HOURS_MIN,
  BelowMinimumPolicy,
  DEFAULT_CHARGE_LEAD_HOURS_MAX,
  DEFAULT_CHARGE_LEAD_HOURS_MIN,
  GUIDE_WARNING_HORIZON_DAYS_MAX,
  GUIDE_WARNING_HORIZON_DAYS_MIN,
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
  // 0 es válido (venta hasta la salida), así que un campo vacío no puede convertirse en 0 sin que
  // nadie lo escriba: vacío falla (spec 0041).
  booking_cutoff_hours: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number().int().min(BOOKING_CUTOFF_HOURS_MIN).max(BOOKING_CUTOFF_HOURS_MAX),
  ),
  below_minimum_policy: z.nativeEnum(BelowMinimumPolicy),
  // Vacío falla: un campo borrado no puede convertirse en un número que nadie escribió.
  guide_warning_horizon_days: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number().int().min(GUIDE_WARNING_HORIZON_DAYS_MIN).max(GUIDE_WARNING_HORIZON_DAYS_MAX),
  ),
});

export type BusinessSettingsForm = z.infer<typeof BusinessSettingsFormSchema>;

export type BusinessSettings = Pick<
  Tables<'business_settings'>,
  | 'minimum_decision_window_hours'
  | 'default_charge_lead_hours'
  | 'booking_cutoff_hours'
  | 'below_minimum_policy'
  | 'guide_warning_horizon_days'
  | 'updated_at'
  | 'operator_legal_name'
  | 'operator_tax_id'
  | 'operator_address'
  | 'operator_brand'
  | 'operator_contact_email'
  | 'operator_privacy_email'
  | 'operator_phone'
  | 'operator_hours'
  | 'operator_ict_declaration'
  | 'operator_has_liability_policy'
  | 'no_show_tolerance_minutes'
>;

export type SettingsFormResult = { success: true } | { success: false; error: SettingsActionError };
