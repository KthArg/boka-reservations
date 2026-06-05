import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { hashBookingToken } from './booking-token-hash';

export { hashBookingToken } from './booking-token-hash';

type ServiceClient = SupabaseClient<Database>;

/**
 * Valida el token del magic link de la reserva. Devuelve el `booking_id` si el
 * token existe y no expiró; null en cualquier otro caso. Actualiza
 * `last_used_at` best-effort (no bloquea la validación si falla). Espejo de
 * `validateGuideToken` (0009).
 */
export async function validateBookingToken(
  db: ServiceClient,
  plaintext: string,
): Promise<string | null> {
  const tokenHash = hashBookingToken(plaintext);
  const { data } = await db
    .from('booking_access_tokens')
    .select('booking_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  await db
    .from('booking_access_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash);

  return data.booking_id;
}
