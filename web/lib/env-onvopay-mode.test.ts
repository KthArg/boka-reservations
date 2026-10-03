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

const { onvopayKeyMode } = await import('@/lib/env');

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
