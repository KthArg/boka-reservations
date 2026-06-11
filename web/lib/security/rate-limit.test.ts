import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// server-only no resuelve en vitest; lo stubbeamos (gotcha del proyecto).
vi.mock('server-only', () => ({}));

// Sentry: no-op observable, sin inicializar.
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (scope: unknown) => void) =>
    fn({ setLevel() {}, setFingerprint() {}, setExtra() {} }),
  captureMessage: vi.fn(),
}));

const rpcMock = vi.fn();
vi.mock('@/lib/db/supabase-service', () => ({
  createSupabaseServiceClient: () => ({ rpc: rpcMock }),
}));

// env mutable: el helper lee env.RATE_LIMIT_ENABLED en cada llamada.
const envMock = { RATE_LIMIT_ENABLED: 'true' };
vi.mock('@/lib/env', () => ({ env: envMock }));

const { checkRateLimit } = await import('./rate-limit');

const KEY = 'login:ip:abc';
const LIMIT = 5;
const WINDOW = 900;

beforeEach(() => {
  envMock.RATE_LIMIT_ENABLED = 'true';
  rpcMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('checkRateLimit', () => {
  it('deja pasar y NO consulta el store cuando RATE_LIMIT_ENABLED=false (kill-switch)', async () => {
    envMock.RATE_LIMIT_ENABLED = 'false';

    const result = await checkRateLimit(KEY, LIMIT, WINDOW);

    expect(result).toEqual({ ok: true });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('devuelve ok cuando el store dice allowed', async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true, retry_after: 0 }], error: null });

    const result = await checkRateLimit(KEY, LIMIT, WINDOW);

    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith('check_rate_limit', {
      p_key: KEY,
      p_limit: LIMIT,
      p_window_seconds: WINDOW,
    });
  });

  it('devuelve no-ok con retryAfter cuando el store dice no allowed', async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: false, retry_after: 42 }], error: null });

    const result = await checkRateLimit(KEY, LIMIT, WINDOW);

    expect(result).toEqual({ ok: false, retryAfter: 42 });
  });

  it('fail-open: deja pasar si el store devuelve error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'connection refused' } });

    const result = await checkRateLimit(KEY, LIMIT, WINDOW);

    expect(result).toEqual({ ok: true });
  });

  it('fail-open: deja pasar si la llamada al store lanza', async () => {
    rpcMock.mockRejectedValue(new Error('store down'));

    const result = await checkRateLimit(KEY, LIMIT, WINDOW);

    expect(result).toEqual({ ok: true });
  });

  it('fail-open: deja pasar si el store devuelve data vacía', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const result = await checkRateLimit(KEY, LIMIT, WINDOW);

    expect(result).toEqual({ ok: true });
  });
});
