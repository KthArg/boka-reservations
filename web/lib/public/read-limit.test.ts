// INFRA-05 (spec 0023): el portal público frena scraping por IP. Se mockean las fronteras
// que no existen en el runtime de vitest (next/headers, el store del rate-limit) y se verifica
// que el helper traduce el resultado de checkRateLimit a un booleano de "frenar", usando el
// prefijo y los parámetros holgados correctos.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RATE_LIMITS } from '@shared/constants/rate-limit';

vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
vi.mock('@/lib/security/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/security/client-ip', () => ({ getClientIp: vi.fn(() => '1.2.3.4') }));

const { checkRateLimit } = await import('@/lib/security/rate-limit');
const { isPublicReadThrottled } = await import('@/lib/public/read-limit');
const mockedCheck = vi.mocked(checkRateLimit);

beforeEach(() => {
  mockedCheck.mockReset();
});

describe('isPublicReadThrottled (INFRA-05)', () => {
  it('no frena cuando el límite no se excedió', async () => {
    mockedCheck.mockResolvedValue({ ok: true });
    expect(await isPublicReadThrottled()).toBe(false);
  });

  it('frena cuando el límite se excedió', async () => {
    mockedCheck.mockResolvedValue({ ok: false, retryAfter: 30 });
    expect(await isPublicReadThrottled()).toBe(true);
  });

  it('consume el límite con el prefijo y los parámetros holgados del portal', async () => {
    mockedCheck.mockResolvedValue({ ok: true });
    await isPublicReadThrottled();

    const [key, limit, windowSeconds] = mockedCheck.mock.calls[0];
    expect(key.startsWith('public:ip:')).toBe(true);
    expect(limit).toBe(RATE_LIMITS.publicReadPerIp.limit);
    expect(windowSeconds).toBe(RATE_LIMITS.publicReadPerIp.windowSeconds);
  });
});
