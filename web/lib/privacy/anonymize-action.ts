'use server';

import { z } from 'zod';
import { requireRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { UserRole } from '@shared/constants/enums';
import { loadErasurePreview, type ErasurePreview } from './preview';

export interface AnonymizeResult {
  anonymizedCount: number;
  deletedCount: number;
}

export type PrivacyError = 'unauthorized' | 'invalid-email' | 'pending-refund' | 'error-generic';

export type AnonymizeOutcome =
  | { ok: true; result: AnonymizeResult }
  | { ok: false; error: PrivacyError };

export type PreviewOutcome =
  | { ok: true; preview: ErasurePreview }
  | { ok: false; error: PrivacyError };

const EmailSchema = z.string().trim().toLowerCase().email();

/**
 * Qué pasaría al borrar los datos de una persona (spec 0036): cuántas reservas tiene por estado,
 * cuántas son de tours futuros y si hay dinero pendiente de devolverle. No muestra datos.
 */
export async function previewCustomerErasure(email: string): Promise<PreviewOutcome> {
  const actor = await requireRole(UserRole.Admin).catch(() => null);
  if (!actor) return { ok: false, error: 'unauthorized' };

  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: 'invalid-email' };

  try {
    return { ok: true, preview: await loadErasurePreview(parsed.data) };
  } catch (err) {
    console.error('[privacy] preview:', err instanceof Error ? err.message : '');
    return { ok: false, error: 'error-generic' };
  }
}

/**
 * Borra los datos de una persona a partir de su correo (derecho de eliminación, Ley 8968; aviso
 * de privacidad, P7). Admin-only. Las reservas con rastro financiero (o en payment_mismatch) se
 * anonimizan conservando los montos; las abandonadas se borran. Con un reembolso sin terminar no
 * se borra nada: la persona perdería el aviso de su dinero. La función SQL deja registro en
 * audit_logs.
 */
export async function anonymizeCustomerByEmail(email: string): Promise<AnonymizeOutcome> {
  const actor = await requireRole(UserRole.Admin).catch(() => null);
  if (!actor) return { ok: false, error: 'unauthorized' };

  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: 'invalid-email' };

  try {
    const preview = await loadErasurePreview(parsed.data);
    if (preview.pendingRefunds > 0) return { ok: false, error: 'pending-refund' };
  } catch (err) {
    console.error('[privacy] preview:', err instanceof Error ? err.message : '');
    return { ok: false, error: 'error-generic' };
  }

  const db = createSupabaseServiceClient();
  const { data, error } = await db.rpc('anonymize_booking_pii_by_email', {
    p_email: parsed.data,
    p_actor_id: actor.id,
  });

  if (error) {
    console.error('[privacy] anonymize:', error.message);
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
