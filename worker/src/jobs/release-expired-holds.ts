import { createClient } from '@supabase/supabase-js';
import { env } from '../env.js';

export async function releaseExpiredHolds(): Promise<void> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const now = new Date().toISOString();

  const { error } = await db
    .from('tour_holds')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('expires_at', now);

  if (error) throw new Error(`Error al expirar holds: ${error.message}`);

  console.log(`[release-expired-holds] done — ${now}`);
}
