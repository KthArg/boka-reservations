import { getDb } from '../db.js';

export async function releaseExpiredHolds(): Promise<void> {
  const db = getDb();

  const now = new Date().toISOString();

  const { error } = await db
    .from('tour_holds')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('expires_at', now);

  if (error) throw new Error(`Error al expirar holds: ${error.message}`);

  console.log(`[release-expired-holds] done — ${now}`);
}
