// Rate limiting — función SQL check_rate_limit y helper checkRateLimit (spec 0017, M-3).
// Prueba el conteo/reset por ventana y, sobre todo, la ATOMICIDAD bajo llamadas
// concurrentes (mismo rigor que availability.concurrency.test.ts): N requests en paralelo
// no deben pasar el límite. Requiere: supabase start. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';

// server-only no resuelve en vitest; lo stubbeamos para poder importar el helper real.
vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (scope: unknown) => void) =>
    fn({ setLevel() {}, setFingerprint() {}, setExtra() {} }),
  captureMessage: () => undefined,
}));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
const { checkRateLimit } = await import('@/lib/security/rate-limit');

const WINDOW_SECONDS = 60;
let key: string;

beforeEach(() => {
  key = `test:${crypto.randomUUID()}`;
});

afterEach(async () => {
  await admin.from('rate_limits').delete().eq('key', key);
});

async function check(limit: number) {
  const { data, error } = await admin.rpc('check_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: WINDOW_SECONDS,
  });
  if (error) throw new Error(error.message);
  return data![0];
}

describe('check_rate_limit (función SQL)', () => {
  it('permite exactamente hasta el límite y bloquea el siguiente', async () => {
    const limit = 3;

    expect((await check(limit)).allowed).toBe(true); // 1
    expect((await check(limit)).allowed).toBe(true); // 2
    expect((await check(limit)).allowed).toBe(true); // 3

    const blocked = await check(limit); // 4
    expect(blocked.allowed).toBe(false);
    expect(blocked.retry_after).toBeGreaterThan(0);
    expect(blocked.retry_after).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  it('resetea el conteo cuando la ventana vence', async () => {
    const limit = 1;

    expect((await check(limit)).allowed).toBe(true);
    expect((await check(limit)).allowed).toBe(false);

    // Backdating de la ventana más allá del window → la próxima llamada la resetea.
    const past = new Date(Date.now() - (WINDOW_SECONDS + 5) * 1000).toISOString();
    await admin.from('rate_limits').update({ window_start: past }).eq('key', key);

    expect((await check(limit)).allowed).toBe(true);

    const { data: row } = await admin.from('rate_limits').select('count').eq('key', key).single();
    expect(row!.count).toBe(1);
  });

  it('atomicidad: 12 llamadas concurrentes con límite 5 — exactamente 5 permitidas', async () => {
    const limit = 5;

    const results = await Promise.all(Array.from({ length: 12 }, () => check(limit)));

    const allowed = results.filter((r) => r.allowed);
    const blocked = results.filter((r) => !r.allowed);

    expect(allowed).toHaveLength(5);
    expect(blocked).toHaveLength(7);

    const { data: row } = await admin.from('rate_limits').select('count').eq('key', key).single();
    expect(row!.count).toBe(12);
  });
});

describe('checkRateLimit (helper contra DB real)', () => {
  it('mapea el shape real del RPC: ok dentro del límite, no-ok al exceder', async () => {
    const limit = 2;

    expect(await checkRateLimit(key, limit, WINDOW_SECONDS)).toEqual({ ok: true });
    expect(await checkRateLimit(key, limit, WINDOW_SECONDS)).toEqual({ ok: true });

    const blocked = await checkRateLimit(key, limit, WINDOW_SECONDS);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});
