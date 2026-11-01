import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del cliente compartido antes de importar el job
vi.mock('../../src/db.js', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '../../src/db.js';
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

    vi.mocked(getDb).mockReturnValue({ from: mockFrom } as never);

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

    vi.mocked(getDb).mockReturnValue({ from: mockFrom } as never);

    await expect(releaseExpiredHolds()).rejects.toThrow('DB error');
  });

  it('filtra por expires_at con un timestamp ISO válido', async () => {
    const mockLt = vi.fn().mockResolvedValue({ error: null });
    const mockEq = vi.fn().mockReturnValue({ lt: mockLt });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

    vi.mocked(getDb).mockReturnValue({
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
