import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// Token de acceso a la reserva (spec 0011). Vive acá porque el worker es
// self-contained (no importa @shared en runtime). Mismo algoritmo de hash que
// la validación en web (`hashBookingToken`).
const TOKEN_BYTES = 32;

/** Hash determinístico del token. Mismo algoritmo que la validación en web. */
export function hashBookingToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Emite un token de acceso para la reserva: crea el plano, guarda solo el hash
 * con expiración al inicio del tour, y devuelve el plano (que viaja únicamente
 * en el email). Cada email emite su propio token, así múltiples links siguen
 * siendo válidos. Espejo de `issueGuideToken` (0009).
 */
export async function issueBookingToken(
  db: SupabaseClient,
  bookingId: string,
  expiresAtIso: string,
): Promise<string> {
  const plaintext = randomBytes(TOKEN_BYTES).toString('base64url');

  const { error } = await db.from('booking_access_tokens').insert({
    booking_id: bookingId,
    token_hash: hashBookingToken(plaintext),
    expires_at: expiresAtIso,
  });
  if (error) throw new Error(`issue booking token: ${error.message}`);

  return plaintext;
}
