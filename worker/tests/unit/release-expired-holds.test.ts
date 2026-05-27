import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del módulo de Supabase antes de importar el job
vi.mock('@supabase/supabase-js', () => {
  const buildChain = (overrides: Record<string, unknown> = {}) => {
    const chain: Record<string, unknown> = {
      update: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      ...overrides,
    };
    return chain;
  };

  return {
    createClient: vi.fn(() => ({
      from: vi.fn(() => buildChain()),
    })),
  };
});

// Mock de env
vi.mock('../../src/env.js', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
}));

import { createClient } from '@supabase/supabase-js';
import { releaseExpiredHolds } from '../../src/jobs/release-expired-holds.js';

describe('releaseExpiredHolds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('actualiza holds activos expirados a status expired', async () => {
    const mockLt = vi.fn().mockResolvedValue({ error: null });
    const mockEq = vi.fn().mockReturnValue({ lt: mockLt });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });

    vi.mocked(createClient).mockReturnValue({ from: mockFrom } as never);

    await releaseExpiredHolds();

    expect(mockFrom).toHaveBeenCalledWith('tour_holds');
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'expired' });
    expect(mockEq).toHaveBeenCalledWith('status', 'active');
    expect(mockLt).toHaveBeenCalledWith('expires_at', expect.any(String));
  });

  it('lanza error si la query falla', async () => {
    const mockLt = vi.fn().mockResolvedValue({ error: { message: 'DB error' } });
    const mockEq = vi.fn().mockReturnValue({ lt: mockLt });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });

    vi.mocked(createClient).mockReturnValue({ from: mockFrom } as never);

    await expect(releaseExpiredHolds()).rejects.toThrow('DB error');
  });

  it('filtra por expires_at con un timestamp ISO válido', async () => {
    const mockLt = vi.fn().mockResolvedValue({ error: null });
    const mockEq = vi.fn().mockReturnValue({ lt: mockLt });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

    vi.mocked(createClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ update: mockUpdate }),
    } as never);

    const before = new Date().toISOString();
    await releaseExpiredHolds();
    const after = new Date().toISOString();

    const calledWith = vi.mocked(mockLt).mock.calls[0]?.[1] as string;
    expect(calledWith >= before).toBe(true);
    expect(calledWith <= after).toBe(true);
    expect(() => new Date(calledWith)).not.toThrow();
  });
});
