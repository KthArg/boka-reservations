import { createClient } from '@supabase/supabase-js';
import { env } from '../env.js';

// Purga filas cuya ventana venció hace rato, para que la tabla rate_limits no crezca sin
// techo (una fila por IP/email visto). Umbral holgado (24h) muy por encima de la ventana
// más larga del spec 0017 (forgot, 1h), así nunca se borra una ventana en uso. Duplicado
// acá (no importado de @shared) porque el worker no resuelve ese alias en runtime.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function cleanupRateLimits(): Promise<void> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { error } = await db.from('rate_limits').delete().lt('window_start', cutoff);

  if (error) throw new Error(`Error al limpiar rate_limits: ${error.message}`);

  console.log(`[cleanup-rate-limits] done — cutoff ${cutoff}`);
}
