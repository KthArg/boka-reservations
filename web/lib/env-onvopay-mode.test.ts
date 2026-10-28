// Las dos llaves de OnvoPay tienen que ser del mismo modo (deuda del spec 0029): el modo se lee
// del prefijo, sin exponer el resto de la llave.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', async (importOriginal) => {
  // El módulo valida process.env al importarse; acá solo interesa la función pura.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
  vi.stubEnv('ONVOPAY_SECRET_KEY', 'onvo_test_secret_x');
  vi.stubEnv('ONVOPAY_WEBHOOK_SECRET', 'whsec');
  vi.stubEnv('NEXT_PUBLIC_ONVOPAY_PUBLIC_KEY', 'onvo_test_publishable_x');
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubEnv('INVITE_SIGNING_SECRET', 'invite');
  return importOriginal();
});

const { isTestKeyInProduction, isTurnstileTestSecret, isTurnstileTestSiteKey, onvopayKeyMode } =
  await import('@/lib/env');

describe('onvopayKeyMode', () => {
  it('reads the mode from the key prefix', () => {
    expect(onvopayKeyMode('onvo_test_secret_abc')).toBe('test');
    expect(onvopayKeyMode('onvo_live_publishable_abc')).toBe('live');
  });

  it('returns null when the prefix does not say', () => {
    expect(onvopayKeyMode('sk_something')).toBeNull();
    expect(onvopayKeyMode('')).toBeNull();
  });
});

describe('isTurnstileTestSecret', () => {
  it('reconoce las tres llaves secretas públicas de prueba de Cloudflare', () => {
    for (const secret of [
      '1x0000000000000000000000000000000AA',
      '2x0000000000000000000000000000000AA',
      '3x0000000000000000000000000000000AA',
    ]) {
      expect(isTurnstileTestSecret(secret)).toBe(true);
    }
  });

  it('no confunde una llave real con una de prueba', () => {
    expect(isTurnstileTestSecret('0x4AAAAAAABkMYinukE8nzYS-real')).toBe(false);
    expect(isTurnstileTestSecret('1x0000000000000000000000000000000AAextra')).toBe(false);
  });
});

describe('isTestKeyInProduction (spec 0048, Fase B)', () => {
  const REAL = { TURNSTILE_SECRET_KEY: '0x4AAAreal', NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAsite' };
  const TEST_SECRET = '1x0000000000000000000000000000000AA';
  const TEST_SITE_KEY = '1x00000000000000000000AA';

  it('reconoce las sitekeys públicas de prueba de Cloudflare', () => {
    for (const key of [
      '1x00000000000000000000AA',
      '2x00000000000000000000AB',
      '1x00000000000000000000BB',
      '3x00000000000000000000FF',
    ]) {
      expect(isTurnstileTestSiteKey(key)).toBe(true);
    }
    expect(isTurnstileTestSiteKey('0x4AAAAAAABkMYinukE8nzYS')).toBe(false);
  });

  it('en el deploy de producción no acepta un secreto ni una sitekey de prueba', () => {
    vi.stubEnv('VERCEL_ENV', 'production');

    expect(
      isTestKeyInProduction({
        CAPTCHA_ENABLED: 'true',
        ...REAL,
        TURNSTILE_SECRET_KEY: TEST_SECRET,
      }),
    ).toBe(true);
    expect(
      isTestKeyInProduction({
        CAPTCHA_ENABLED: 'true',
        ...REAL,
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY,
      }),
    ).toBe(true);
    expect(isTestKeyInProduction({ CAPTCHA_ENABLED: 'true', ...REAL })).toBe(false);
    vi.unstubAllEnvs();
  });

  it('las llaves de prueba valen fuera de producción o con el captcha apagado', () => {
    const testKeys = {
      TURNSTILE_SECRET_KEY: TEST_SECRET,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY,
    };
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(isTestKeyInProduction({ CAPTCHA_ENABLED: 'true', ...testKeys })).toBe(false);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(isTestKeyInProduction({ CAPTCHA_ENABLED: 'false', ...testKeys })).toBe(false);
    vi.unstubAllEnvs();
  });
});
