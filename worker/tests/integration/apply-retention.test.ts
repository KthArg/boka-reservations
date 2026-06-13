// Job apply-retention — integración contra DB real (spec 0022, PRIV-03). Verifica que con
// RETENTION_ENABLED corre las funciones de retención (purga un token vencido) y es idempotente,
// y que con el kill-switch en false no toca nada. Requiere: supabase start.
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../web/types/database.js';

const mockEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  APP_URL: 'http://localhost:3000',
  RETENTION_ENABLED: true,
};
vi.mock('../../src/env.js', () => ({ env: mockEnv }));

const { applyRetention } = await import('../../src/jobs/apply-retention.js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const DAY_MS = 24 * 60 * 60 * 1000;
const createdHashes: string[] = [];
let guideId: string;

async function seedExpiredGuideToken(prefix: string): Promise<string> {
  const hash = `${prefix}-${crypto.randomUUID()}`;
  createdHashes.push(hash);
  await admin.from('guide_access_tokens').insert({
    guide_id: guideId,
    token_hash: hash,
    expires_at: new Date(Date.now() - 400 * DAY_MS).toISOString(),
  });
  return hash;
}

beforeAll(async () => {
  const { data: guide } = await admin
    .from('users')
    .select('id')
    .eq('role', 'guide')
    .limit(1)
    .single();
  guideId = guide!.id;
});

afterEach(async () => {
  mockEnv.RETENTION_ENABLED = true;
  if (createdHashes.length > 0) {
    await admin.from('guide_access_tokens').delete().in('token_hash', createdHashes);
    createdHashes.length = 0;
  }
});

describe('applyRetention (job)', () => {
  it('con RETENTION_ENABLED purga el token vencido y es idempotente', async () => {
    const hash = await seedExpiredGuideToken('worker-exp');

    await applyRetention();
    await applyRetention(); // segunda corrida: idempotente, no lanza

    const { data } = await admin.from('guide_access_tokens').select('id').eq('token_hash', hash);
    expect(data ?? []).toHaveLength(0);
  });

  it('con RETENTION_ENABLED=false no toca nada', async () => {
    mockEnv.RETENTION_ENABLED = false;
    const hash = await seedExpiredGuideToken('worker-noop');

    await applyRetention();

    const { data } = await admin.from('guide_access_tokens').select('id').eq('token_hash', hash);
    expect(data ?? []).toHaveLength(1);
  });
});
