'use server';

import { requireRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { UserRole } from '@shared/constants/enums';

export interface AnonymizeResult {
  anonymizedCount: number;
  deletedCount: number;
}

export type AnonymizeOutcome =
  | { ok: true; result: AnonymizeResult }
  | { ok: false; error: 'unauthorized' | 'error-generic' };

/**
 * Anonimiza toda la PII de un titular a partir de su email (derecho de eliminación,
 * Ley 8968 — spec 0022, PRIV-02). Admin-only. No tiene UI todavía: se invoca como
 * server action desde una futura pantalla del panel. Las reservas con rastro financiero
 * (o en payment_mismatch) se anonimizan conservando los montos; las abandonadas se borran.
 * La función SQL valida identidad (service_role) y deja registro en audit_logs.
 */
export async function anonymizeCustomerByEmail(email: string): Promise<AnonymizeOutcome> {
  const actor = await requireRole(UserRole.Admin).catch(() => null);
  if (!actor) return { ok: false, error: 'unauthorized' };

  const db = createSupabaseServiceClient();
  const { data, error } = await db.rpc('anonymize_booking_pii_by_email', {
    p_email: email,
    p_actor_id: actor.id,
  });

  if (error) {
    console.error('[anonymize-action] error:', error.message);
    return { ok: false, error: 'error-generic' };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    result: {
      anonymizedCount: row?.anonymized_count ?? 0,
      deletedCount: row?.deleted_count ?? 0,
    },
  };
}
