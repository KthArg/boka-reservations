import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// TTL del token del guía (spec 0009). Vive acá porque es el único consumidor:
// el worker es self-contained (no importa @shared en runtime).
const TOKEN_TTL_DAYS = 30;
const TOKEN_BYTES = 32;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Hash determinístico del token. Mismo algoritmo que la validación en web. */
export function hashGuideToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Genera un token de acceso para el guía: crea el plano, guarda solo el hash
 * con expiración a 30 días, y devuelve el plano (que viaja únicamente en el
 * email). No reutiliza tokens: el hash impide recuperar planos previos.
 */
export async function issueGuideToken(db: SupabaseClient, guideId: string): Promise<string> {
  const plaintext = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * MS_PER_DAY).toISOString();

  const { error } = await db.from('guide_access_tokens').insert({
    guide_id: guideId,
    token_hash: hashGuideToken(plaintext),
    expires_at: expiresAt,
  });
  if (error) throw new Error(`issue guide token: ${error.message}`);

  return plaintext;
}
