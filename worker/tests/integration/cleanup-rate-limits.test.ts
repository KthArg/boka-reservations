// Job cleanup-rate-limits — integración contra DB real (spec 0017). Verifica que purga
// las filas con ventana vencida hace rato y conserva las recientes. Requiere: supabase start.
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../web/types/database.js';

vi.mock('../../src/env.js', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    APP_URL: 'http://localhost:3000',
  },
}));

const { cleanupRateLimits } = await import('../../src/jobs/cleanup-rate-limits.js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const staleKey = `cleanup-stale:${crypto.randomUUID()}`;
const freshKey = `cleanup-fresh:${crypto.randomUUID()}`;

afterEach(async () => {
  await admin.from('rate_limits').delete().in('key', [staleKey, freshKey]);
});

describe('cleanupRateLimits', () => {
  it('borra ventanas vencidas hace más de 24h y conserva las recientes', async () => {
    const old = new Date(Date.now() - TWO_DAYS_MS).toISOString();
    await admin.from('rate_limits').insert([
      { key: staleKey, window_start: old, count: 9 },
      { key: freshKey, window_start: new Date().toISOString(), count: 1 },
    ]);

    await cleanupRateLimits();

    const { data: stale } = await admin.from('rate_limits').select('key').eq('key', staleKey);
    const { data: fresh } = await admin.from('rate_limits').select('key').eq('key', freshKey);

    expect(stale ?? []).toHaveLength(0);
    expect(fresh ?? []).toHaveLength(1);
  });
});
