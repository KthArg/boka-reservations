import { beforeEach, describe, expect, it, vi } from 'vitest';

// Alerta de salidas acaparadas (spec 0048 §5.3). Sentry es un servicio externo: se simula para
// leer nivel, fingerprint y que el evento no lleve PII.
const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  setLevel: vi.fn(),
  setFingerprint: vi.fn(),
  setTag: vi.fn(),
  setExtras: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  captureMessage: sentry.captureMessage,
  withScope: (cb: (scope: unknown) => void) =>
    cb({
      setLevel: sentry.setLevel,
      setFingerprint: sentry.setFingerprint,
      setTag: sentry.setTag,
      setExtras: sentry.setExtras,
    }),
}));

const { checkDeferredHoarding, HOARDING_SHARE, HOARDING_MAX_IDENTITIES } =
  await import('../../src/jobs/deferred-hoarding.js');

const CANDIDATE = {
  instance_id: 'inst-1',
  starts_at: '2026-11-01T14:00:00Z',
  tour_name: 'Tour nocturno',
  capacity: 20,
  held_seats: 10,
  distinct_emails: 5,
  distinct_cards: 1,
};

function dbReturning(result: { data: unknown; error: { message: string } | null }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkDeferredHoarding', () => {
  it('asks the database with the spec thresholds (50 %, 2 identities)', async () => {
    // Arrange
    const db = dbReturning({ data: [], error: null });

    // Act
    await checkDeferredHoarding(db);

    // Assert
    expect(HOARDING_SHARE).toBe(0.5);
    expect(HOARDING_MAX_IDENTITIES).toBe(2);
    expect(db.rpc).toHaveBeenCalledWith('deferred_hoarding_candidates', {
      p_share: 0.5,
      p_max_identities: 2,
    });
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('sends one warning per departure, grouped by departure, without emails or cards', async () => {
    // Arrange
    const db = dbReturning({ data: [CANDIDATE], error: null });

    // Act
    await checkDeferredHoarding(db);

    // Assert
    expect(sentry.setLevel).toHaveBeenCalledWith('warning');
    expect(sentry.setFingerprint).toHaveBeenCalledWith(['deferred-hoarding', 'inst-1']);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage.mock.calls[0]?.[0]).toContain('50 %');
    expect(sentry.setExtras).toHaveBeenCalledWith(
      expect.objectContaining({ percent: 50, distinct_emails: 5, distinct_cards: 1 }),
    );
    const payload = JSON.stringify([sentry.captureMessage.mock.calls, sentry.setExtras.mock.calls]);
    expect(payload).not.toMatch(/@/);
  });

  it('throws when the query fails so index.ts reports it', async () => {
    const db = dbReturning({ data: null, error: { message: 'boom' } });

    await expect(checkDeferredHoarding(db)).rejects.toThrow('deferred_hoarding_candidates: boom');
  });
});
