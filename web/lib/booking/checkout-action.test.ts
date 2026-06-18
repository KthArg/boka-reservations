// Consentimiento obligatorio en el checkout (spec 0021, P1-3). La server action depende de
// next/headers, next-intl/server y los módulos de rate-limit, que no existen en el runtime de
// vitest: se mockean esas fronteras. initCheckout también se mockea para verificar que NO se
// invoca cuando falta el consentimiento (la validación debe cortar antes de crear inventario).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/booking/create', () => ({ initCheckout: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: () => null })),
  cookies: vi.fn(async () => ({ set: vi.fn() })),
}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'es') }));
vi.mock('@/lib/security/rate-limit', () => ({ checkRateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/security/client-ip', () => ({ getClientIp: vi.fn(() => '1.2.3.4') }));

const { initCheckout } = await import('@/lib/booking/create');
const { checkoutAction } = await import('@/lib/booking/checkout-action');

function buildForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('instance_id', crypto.randomUUID());
  fd.set('name', 'Turista Test');
  fd.set('email', 'turista@example.com');
  fd.set('adult', '1');
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe('checkoutAction — consentimiento (spec 0021, P1-3)', () => {
  it('rechaza la reserva si falta el consentimiento, sin invocar initCheckout', async () => {
    const result = await checkoutAction(null, buildForm());

    expect(result).toEqual({ error: 'error-generic' });
    expect(initCheckout).not.toHaveBeenCalled();
  });

  it('rechaza un nombre demasiado largo (APPSEC-02), sin invocar initCheckout', async () => {
    const result = await checkoutAction(
      null,
      buildForm({ name: 'a'.repeat(121), consent: 'accepted' }),
    );

    expect(result).toEqual({ error: 'error-generic' });
    expect(initCheckout).not.toHaveBeenCalled();
  });

  it('con consentimiento y datos válidos, invoca initCheckout y devuelve el payment intent', async () => {
    vi.mocked(initCheckout).mockResolvedValue({
      externalPaymentId: 'pi_test',
      bookingId: 'bk_test',
    });

    const result = await checkoutAction(null, buildForm({ consent: 'accepted' }));

    expect(initCheckout).toHaveBeenCalledOnce();
    expect(vi.mocked(initCheckout).mock.calls[0][0]).toMatchObject({ consentAccepted: true });
    expect(result).toEqual({ paymentIntentId: 'pi_test', bookingId: 'bk_test' });
  });
});
