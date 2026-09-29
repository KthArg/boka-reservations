import 'server-only';
import { cache } from 'react';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { BOOKING_CUTOFF_HOURS_DEFAULT, BUSINESS_SETTINGS_ID } from '@shared/constants/settings';
import type { OperatorIdentity } from './types';

// Lectura de la identidad del operador (spec 0034). La leen páginas públicas (términos, pie del
// sitio, checkout) que visita gente sin sesión, y la RLS de business_settings solo deja leer a
// admin y staff: por eso va con el service client y seleccionando únicamente columnas públicas.

const OPERATOR_COLUMNS = `
  operator_legal_name, operator_tax_id, operator_address, operator_brand,
  operator_contact_email, operator_privacy_email, operator_phone, operator_hours,
  operator_ict_declaration, operator_has_liability_policy
`;

type OperatorRow = {
  operator_legal_name: string;
  operator_tax_id: string;
  operator_address: string;
  operator_brand: string;
  operator_contact_email: string;
  operator_privacy_email: string;
  operator_phone: string;
  operator_hours: string;
  operator_ict_declaration: string;
  operator_has_liability_policy: boolean;
};

export function toOperatorIdentity(row: OperatorRow): OperatorIdentity {
  return {
    legalName: row.operator_legal_name,
    taxId: row.operator_tax_id,
    address: row.operator_address,
    brand: row.operator_brand,
    contactEmail: row.operator_contact_email,
    privacyEmail: row.operator_privacy_email,
    phone: row.operator_phone,
    hours: row.operator_hours,
    ictDeclaration: row.operator_ict_declaration,
    hasLiabilityPolicy: row.operator_has_liability_policy,
  };
}

/** Una lectura por request aunque la pidan el layout, la página y la acción. */
export const getOperatorIdentity = cache(async (): Promise<OperatorIdentity> => {
  const db = createSupabaseServiceClient();
  const { data, error } = await db
    .from('business_settings')
    .select(OPERATOR_COLUMNS)
    .eq('id', BUSINESS_SETTINGS_ID)
    .single<OperatorRow>();
  if (error) throw new Error(`getOperatorIdentity: ${error.message}`);
  return toOperatorIdentity(data);
});

/**
 * Tolerancia de llegada tarde vigente (spec 0034). La muestra el resumen de compra; cada reserva
 * copia el valor al crearse, así que cambiarla no altera lo que aceptaron las reservas previas.
 */
export const getNoShowToleranceMinutes = cache(async (): Promise<number> => {
  const db = createSupabaseServiceClient();
  const { data, error } = await db
    .from('business_settings')
    .select('no_show_tolerance_minutes')
    .eq('id', BUSINESS_SETTINGS_ID)
    .single();
  if (error) throw new Error(`getNoShowToleranceMinutes: ${error.message}`);
  return data.no_show_tolerance_minutes;
});

/**
 * Anticipación mínima para reservar en línea (spec 0041). La usa el calendario para no mostrar
 * salidas cerradas; la base (`create_hold_atomic`) es la que decide. Si la lectura falla, se
 * registra y se usa el valor por defecto: mostrar de más no vende de más.
 */
export const getBookingCutoffHours = cache(async (): Promise<number> => {
  const db = createSupabaseServiceClient();
  const { data, error } = await db
    .from('business_settings')
    .select('booking_cutoff_hours')
    .eq('id', BUSINESS_SETTINGS_ID)
    .single();
  if (error) {
    console.error('[operator] no se pudo leer la anticipación mínima:', error.message);
    return BOOKING_CUTOFF_HOURS_DEFAULT;
  }
  return data.booking_cutoff_hours;
});
