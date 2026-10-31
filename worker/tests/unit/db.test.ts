import { describe, it, expect, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock('../../src/env.js', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  },
}));

import { createClient } from '@supabase/supabase-js';
import { getDb } from '../../src/db.js';

describe('getDb', () => {
  it('reutiliza un solo cliente sin renovación de sesión', () => {
    const first = getDb();
    const second = getDb();

    expect(second).toBe(first);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith('http://localhost:54321', 'test-service-key', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });
});
