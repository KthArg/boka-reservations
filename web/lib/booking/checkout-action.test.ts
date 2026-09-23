// Aceptaciones obligatorias en el checkout: términos y datos, por separado (specs 0021 y 0031). La server action depende de
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
// Flag del cobro diferido (spec 0029): lee la env tipada, que no existe en este runtime.
const flag = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/lib/booking/deferred-flag', () => ({ isDeferredChargeEnabled: () => flag.enabled }));

const { initCheckout } = await import('@/lib/booking/create');
const { checkoutAction } = await import('@/lib/booking/checkout-action');

// Las dos casillas del checkout (spec 0031). Sin ellas, cualquier formulario se rechaza.
const ACCEPTED = { terms: 'accepted', privacy_consent: 'accepted' };

function buildForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('instance_id', crypto.randomUUID());
  fd.set('name', 'Turista Test');
  fd.set('email', 'turista@example.com');
  fd.set('adult', '1');
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe('checkoutAction — aceptaciones legales (specs 0021 y 0031)', () => {
  it.each([
    ['sin ninguna casilla', {}],
    ['sin la casilla de términos', { privacy_consent: 'accepted' }],
    ['sin la casilla de datos', { terms: 'accepted' }],
    ['con el campo `consent` de la versión anterior del formulario', { consent: 'accepted' }],
  ])('rechaza la reserva %s, sin invocar initCheckout', async (_case, fields) => {
    const result = await checkoutAction(null, buildForm(fields));

    expect(result).toEqual({ error: 'error-generic' });
    expect(initCheckout).not.toHaveBeenCalled();
  });

  it('rechaza un nombre demasiado largo (APPSEC-02), sin invocar initCheckout', async () => {
    const result = await checkoutAction(null, buildForm({ name: 'a'.repeat(121), ...ACCEPTED }));

    expect(result).toEqual({ error: 'error-generic' });
    expect(initCheckout).not.toHaveBeenCalled();
  });

  it('con las dos casillas y datos válidos, invoca initCheckout y devuelve el payment intent', async () => {
    vi.mocked(initCheckout).mockResolvedValue({
      externalPaymentId: 'pi_test',
      bookingId: 'bk_test',
    });

    const result = await checkoutAction(null, buildForm(ACCEPTED));

    expect(initCheckout).toHaveBeenCalledOnce();
    expect(vi.mocked(initCheckout).mock.calls[0][0]).toMatchObject({ legalAccepted: true });
    expect(result).toEqual({ paymentIntentId: 'pi_test', bookingId: 'bk_test' });
  });
});

describe('checkoutAction — cobro diferido activo (spec 0029 §11)', () => {
  it('no crea un cobro inmediato con el widget cuando el flag está encendido', async () => {
    vi.mocked(initCheckout).mockClear();
    flag.enabled = true;

    const result = await checkoutAction(null, buildForm(ACCEPTED));

    flag.enabled = false;
    expect(result).toEqual({ error: 'error-generic' });
    expect(initCheckout).not.toHaveBeenCalled();
  });
});
