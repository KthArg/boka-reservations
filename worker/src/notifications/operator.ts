import type { SupabaseClient } from '@supabase/supabase-js';

// Identidad del operador para el pie de los correos (spec 0034). Espejo de
// `web/lib/operator/types.ts`: el worker no importa @shared ni la web en runtime.

export type OperatorIdentity = {
  legalName: string;
  taxId: string;
  address: string;
  brand: string;
  contactEmail: string;
  phone: string;
};

/** Los datos que el pie necesita. Con alguno vacío, el pie lleva solo los enlaces legales. */
export function isFooterIdentityComplete(operator: OperatorIdentity): boolean {
  return Object.values(operator).every((value) => value.trim().length > 0);
}

type OperatorRow = {
  operator_legal_name: string;
  operator_tax_id: string;
  operator_address: string;
  operator_brand: string;
  operator_contact_email: string;
  operator_phone: string;
};

const BUSINESS_SETTINGS_ID = 1;

export async function loadOperatorIdentity(db: SupabaseClient): Promise<OperatorIdentity> {
  const { data, error } = await db
    .from('business_settings')
    .select(
      'operator_legal_name, operator_tax_id, operator_address, operator_brand, operator_contact_email, operator_phone',
    )
    .eq('id', BUSINESS_SETTINGS_ID)
    .single<OperatorRow>();
  if (error) throw new Error(`load operator identity: ${error.message}`);
  return {
    legalName: data.operator_legal_name,
    taxId: data.operator_tax_id,
    address: data.operator_address,
    brand: data.operator_brand,
    contactEmail: data.operator_contact_email,
    phone: data.operator_phone,
  };
}
