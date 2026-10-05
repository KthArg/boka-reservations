import type { SupabaseClient } from '@supabase/supabase-js';

// Política de las salidas bajo el mínimo (spec 0045, business_settings.below_minimum_policy).
// Espeja BelowMinimumPolicy de shared/constants/settings.ts: el worker no importa @shared en
// runtime.

export const BelowMinimumPolicy = {
  /** Decide una persona desde Salidas; el worker nunca cancela una salida con reservas. */
  StaffDecides: 'staff_decides',
  /** Una salida bajo el mínimo se cancela sola, con el aviso de 24 horas. */
  AutoCancel: 'auto_cancel',
} as const;

export type BelowMinimumPolicyValue = (typeof BelowMinimumPolicy)[keyof typeof BelowMinimumPolicy];

const SETTINGS_ID = 1;

/**
 * La política vigente. Si no se puede leer, o trae un valor desconocido, rige `staff_decides`: un
 * dato faltante no cancela reservas.
 */
export async function loadBelowMinimumPolicy(db: SupabaseClient): Promise<BelowMinimumPolicyValue> {
  const { data, error } = await db
    .from('business_settings')
    .select('below_minimum_policy')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) {
    console.error(`[minimum-policy] no se pudo leer la política: ${error.message}`);
    return BelowMinimumPolicy.StaffDecides;
  }
  return data?.below_minimum_policy === BelowMinimumPolicy.AutoCancel
    ? BelowMinimumPolicy.AutoCancel
    : BelowMinimumPolicy.StaffDecides;
}
