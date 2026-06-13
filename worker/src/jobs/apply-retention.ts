import { createClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import { computeRetentionCutoffs } from './retention-windows.js';

// Aplica la política de retención (spec 0022, PRIV-03): anonimiza PII vieja, purga reservas
// no pagadas, tokens vencidos y notificaciones antiguas. Cada paso es independiente: si uno
// falla, se registra y se sigue; al final se lanza un error agregado para que index.ts lo
// reporte a Sentry. Kill-switch RETENTION_ENABLED (default true).
export async function applyRetention(): Promise<void> {
  if (!env.RETENTION_ENABLED) {
    console.log('[apply-retention] disabled (RETENTION_ENABLED=false) — skip');
    return;
  }

  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const cutoffs = computeRetentionCutoffs();

  const steps: Array<{ fn: string; args: Record<string, unknown> }> = [
    { fn: 'anonymize_bookings_past_retention', args: { p_cutoff: cutoffs.piiCutoff } },
    { fn: 'purge_unpaid_bookings', args: { p_cutoff: cutoffs.unpaidCutoff } },
    { fn: 'purge_expired_access_tokens', args: { p_cutoff: cutoffs.tokenCutoff } },
    { fn: 'purge_old_notifications', args: { p_cutoff: cutoffs.notificationCutoff } },
  ];

  const failures: string[] = [];
  for (const step of steps) {
    const { data, error } = (await db.rpc(step.fn, step.args)) as {
      data: number | null;
      error: { message: string } | null;
    };
    if (error) {
      console.error(`[apply-retention] ${step.fn} error:`, error.message);
      failures.push(`${step.fn}: ${error.message}`);
      continue;
    }
    console.log(`[apply-retention] ${step.fn} — affected ${data ?? 0}`);
  }

  if (failures.length > 0) {
    throw new Error(`apply-retention: ${failures.length} step(s) failed — ${failures.join('; ')}`);
  }
}
