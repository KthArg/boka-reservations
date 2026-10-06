import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { GUIDE_WARNING_HORIZON_DAYS } from '@shared/constants/departures';
import { BUSINESS_SETTINGS_ID, BelowMinimumPolicy } from '@shared/constants/settings';
import type { BusinessSettings, BusinessSettingsForm } from './types';

// Acceso a `business_settings` con la sesión del usuario: la RLS de …043 limita la lectura a
// admin/staff y la escritura a admin, y exige que `updated_by` sea quien escribe.

export async function getBusinessSettings(): Promise<BusinessSettings> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('business_settings')
    .select(
      `minimum_decision_window_hours, default_charge_lead_hours, booking_cutoff_hours, updated_at,
       below_minimum_policy, guide_warning_horizon_days,
       operator_legal_name, operator_tax_id, operator_address, operator_brand,
       operator_contact_email, operator_privacy_email, operator_phone, operator_hours,
       operator_ict_declaration, operator_has_liability_policy, no_show_tolerance_minutes`,
    )
    .eq('id', BUSINESS_SETTINGS_ID)
    .single();
  if (error) throw error;
  return data;
}

export type DepartureSettings = {
  belowMinimumPolicy: BelowMinimumPolicy;
  guideWarningHorizonDays: number;
};

/**
 * Lo que la página de Salidas necesita de la configuración: la política de las salidas bajo el
 * mínimo (spec 0045) y la ventana del aviso de salidas sin guía (spec 0046). Si no se puede leer
 * rigen `staff_decides`, igual que en la base y en el worker, y los 14 días iniciales.
 */
export async function getDepartureSettings(): Promise<DepartureSettings> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('business_settings')
    .select('below_minimum_policy, guide_warning_horizon_days')
    .eq('id', BUSINESS_SETTINGS_ID)
    .maybeSingle();
  return {
    belowMinimumPolicy:
      data?.below_minimum_policy === BelowMinimumPolicy.AutoCancel
        ? BelowMinimumPolicy.AutoCancel
        : BelowMinimumPolicy.StaffDecides,
    guideWarningHorizonDays: data?.guide_warning_horizon_days ?? GUIDE_WARNING_HORIZON_DAYS,
  };
}

/** Devuelve false si la escritura falló o la RLS no dejó actualizar la fila. */
export async function updateSettings(
  values: BusinessSettingsForm,
  actorId: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('business_settings')
    .update({ ...values, updated_by: actorId })
    .eq('id', BUSINESS_SETTINGS_ID)
    .select('id');
  if (error) {
    console.error('[settings] no se pudo actualizar la configuración:', error.code, actorId);
    return false;
  }
  // 0 filas sin error: la RLS filtró la fila porque el JWT del actor no tiene rol admin.
  if (data.length !== 1) {
    console.error('[settings] la RLS no permitió actualizar business_settings:', actorId);
    return false;
  }
  return true;
}
