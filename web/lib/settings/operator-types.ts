import { z } from 'zod';
import {
  NO_SHOW_TOLERANCE_MINUTES_MAX,
  NO_SHOW_TOLERANCE_MINUTES_MIN,
  OPERATOR_FIELD_MAX_LENGTH,
} from '@shared/constants/settings';

// Formulario de "Datos del operador y venta" en `/dashboard/settings` (spec 0034). Cada campo de
// texto puede quedar vacío mientras se cargan los datos: la venta se habilita recién cuando están
// todos los obligatorios (`isOperatorIdentityComplete`).

const text = z.string().trim().max(OPERATOR_FIELD_MAX_LENGTH);
const optionalEmail = z.union([z.literal(''), z.string().trim().email()]);

export const OperatorSettingsFormSchema = z.object({
  operator_legal_name: text,
  operator_tax_id: text,
  operator_address: text,
  operator_brand: text,
  operator_contact_email: optionalEmail,
  operator_privacy_email: optionalEmail,
  operator_phone: text,
  operator_hours: text,
  operator_ict_declaration: text,
  operator_has_liability_policy: z.boolean(),
  no_show_tolerance_minutes: z.coerce
    .number()
    .int()
    .min(NO_SHOW_TOLERANCE_MINUTES_MIN)
    .max(NO_SHOW_TOLERANCE_MINUTES_MAX),
});

export type OperatorSettingsForm = z.infer<typeof OperatorSettingsFormSchema>;

/** Los campos de texto, en el orden en que los muestra el formulario. */
export const OPERATOR_TEXT_FIELDS = [
  'operator_legal_name',
  'operator_tax_id',
  'operator_address',
  'operator_brand',
  'operator_contact_email',
  'operator_privacy_email',
  'operator_phone',
  'operator_hours',
  'operator_ict_declaration',
] as const satisfies readonly (keyof OperatorSettingsForm)[];

export type OperatorTextField = (typeof OPERATOR_TEXT_FIELDS)[number];
