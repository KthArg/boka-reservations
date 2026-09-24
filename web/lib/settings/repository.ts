import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { BUSINESS_SETTINGS_ID } from '@shared/constants/settings';
import type { BusinessSettings, BusinessSettingsForm } from './types';

// Acceso a `business_settings` con la sesión del usuario: la RLS de …043 limita la lectura a
// admin/staff y la escritura a admin, y exige que `updated_by` sea quien escribe.

export async function getBusinessSettings(): Promise<BusinessSettings> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('business_settings')
    .select('minimum_decision_window_hours, default_charge_lead_hours, updated_at')
    .eq('id', BUSINESS_SETTINGS_ID)
    .single();
  if (error) throw error;
  return data;
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
