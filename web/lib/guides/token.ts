import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { hashGuideToken } from './hash';

export { hashGuideToken } from './hash';

type ServiceClient = SupabaseClient<Database>;

/**
 * Valida el token del magic link del guía. Devuelve el `guide_id` si el token
 * existe y no expiró; null en cualquier otro caso. Actualiza `last_used_at`
 * best-effort (no bloquea la validación si falla).
 */
export async function validateGuideToken(
  db: ServiceClient,
  plaintext: string,
): Promise<string | null> {
  const tokenHash = hashGuideToken(plaintext);
  const { data } = await db
    .from('guide_access_tokens')
    .select('guide_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  await db
    .from('guide_access_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash);

  return data.guide_id;
}
