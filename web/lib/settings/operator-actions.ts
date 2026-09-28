'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/server';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { writeAuditLog } from '@/lib/audit/log';
import { UserRole } from '@shared/constants/enums';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
  BUSINESS_SETTINGS_AUDIT_ENTITY_ID,
} from '@shared/constants/audit';
import { BUSINESS_SETTINGS_ID, SettingsActionError } from '@shared/constants/settings';
import { OPERATOR_TEXT_FIELDS, OperatorSettingsFormSchema } from './operator-types';
import type { SettingsFormResult } from './types';

/** Valor que manda un checkbox marcado en un FormData. */
const CHECKBOX_ON = 'on';

const OPERATOR_COLUMNS = [
  ...OPERATOR_TEXT_FIELDS,
  'operator_has_liability_policy',
  'no_show_tolerance_minutes',
];

/**
 * Guarda la identidad del operador y la tolerancia de llegada tarde (spec 0034). Solo admin: la
 * RLS de `business_settings` limita la escritura y los grants de columna, qué se puede tocar.
 * Cada cambio se audita con los valores anteriores y nuevos, porque cambian textos que los
 * turistas ya aceptaron (la razón social en los términos, por ejemplo).
 */
export async function updateOperatorSettings(
  _prev: SettingsFormResult | null,
  formData: FormData,
): Promise<SettingsFormResult> {
  const admin = await requireRole(UserRole.Admin).catch(() => null);
  if (!admin) return { success: false, error: SettingsActionError.Unauthorized };

  const raw = Object.fromEntries(
    OPERATOR_TEXT_FIELDS.map((f) => [f, String(formData.get(f) ?? '')]),
  );
  const parsed = OperatorSettingsFormSchema.safeParse({
    ...raw,
    operator_has_liability_policy: formData.get('operator_has_liability_policy') === CHECKBOX_ON,
    no_show_tolerance_minutes: formData.get('no_show_tolerance_minutes'),
  });
  if (!parsed.success) {
    const invalid = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      error: invalid.no_show_tolerance_minutes
        ? SettingsActionError.ToleranceOutOfRange
        : SettingsActionError.OperatorInvalid,
    };
  }

  const supabase = await createSupabaseServerClient();
  // El valor anterior es lo que la auditoría tiene que conservar: sin él no se guarda nada.
  const { data: before, error: readError } = await supabase
    .from('business_settings')
    .select(OPERATOR_COLUMNS.join(', '))
    .eq('id', BUSINESS_SETTINGS_ID)
    .single();
  if (readError) {
    console.error(
      '[settings] no se pudo leer la identidad del operador:',
      readError.code,
      admin.id,
    );
    return { success: false, error: SettingsActionError.UpdateFailed };
  }

  const { data, error } = await supabase
    .from('business_settings')
    .update({ ...parsed.data, updated_by: admin.id })
    .eq('id', BUSINESS_SETTINGS_ID)
    .select('id');
  // 0 filas sin error: la RLS filtró la fila porque el JWT no tiene rol admin.
  if (error || data.length !== 1) {
    console.error(
      '[settings] no se pudo guardar la identidad del operador:',
      error?.code,
      admin.id,
    );
    return { success: false, error: SettingsActionError.UpdateFailed };
  }

  await writeAuditLog(createSupabaseServiceClient(), {
    actorType: AuditActorType.Admin,
    actorId: admin.id,
    action: AuditAction.OperatorSettingsUpdated,
    entityType: AuditEntityType.BusinessSettings,
    entityId: BUSINESS_SETTINGS_AUDIT_ENTITY_ID,
    metadata: { before, after: parsed.data },
  });

  // Cambian el pie, los términos y el resumen de compra: se revalida todo el sitio.
  revalidatePath('/', 'layout');
  return { success: true };
}
