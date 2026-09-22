// Validación del formulario del checkout (specs 0021 y 0031): las dos aceptaciones legales son
// obligatorias por separado. El módulo importa next/headers, next-intl/server y el rate limit, que
// no existen en el runtime de vitest; parseCheckoutInput no los usa, pero se mockean para cargarlo.
import { describe, expect, it, vi } from 'vitest';
import { CHECKOUT_ACCEPTED_VALUE, CheckoutLegalField } from '@shared/constants/legal';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({ checkRateLimit: vi.fn() }));

const { parseCheckoutInput } = await import('./checkout-input');

const BASE_FIELDS = {
  instance_id: '11111111-1111-1111-1111-111111111111',
  name: 'Turista Test',
  email: 'turista@example.com',
  adult: '1',
};

const BOTH_ACCEPTED = {
  [CheckoutLegalField.Terms]: CHECKOUT_ACCEPTED_VALUE,
  [CheckoutLegalField.PrivacyConsent]: CHECKOUT_ACCEPTED_VALUE,
};

function getter(fields: Record<string, string>) {
  const values = new Map(Object.entries({ ...BASE_FIELDS, ...fields }));
  return (key: string) => values.get(key) ?? null;
}

describe('parseCheckoutInput — aceptaciones legales', () => {
  it('devuelve los datos con las dos casillas marcadas', () => {
    expect(parseCheckoutInput(getter(BOTH_ACCEPTED))).toMatchObject({
      instanceId: BASE_FIELDS.instance_id,
      customerName: 'Turista Test',
      customerEmail: 'turista@example.com',
    });
  });

  it.each([
    ['sin ninguna casilla', {}],
    [
      'sin la casilla de términos',
      { [CheckoutLegalField.PrivacyConsent]: CHECKOUT_ACCEPTED_VALUE },
    ],
    ['sin la casilla de datos', { [CheckoutLegalField.Terms]: CHECKOUT_ACCEPTED_VALUE }],
    ['con el campo `consent` de la versión anterior', { consent: CHECKOUT_ACCEPTED_VALUE }],
    ['con una casilla en un valor distinto del marcado', { ...BOTH_ACCEPTED, terms: '' }],
  ])('devuelve null %s', (_case, fields) => {
    expect(parseCheckoutInput(getter(fields))).toBeNull();
  });
});
