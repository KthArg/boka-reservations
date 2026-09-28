// Política de reembolso (specs 0011, 0032 y 0034): ventana de 24 h y motivo de la cancelación.
// Desde el 0034 el reembolso es siempre completo o nada; nunca se descuenta la comisión.
import { describe, it, expect } from 'vitest';
import {
  CANCELLATION_WINDOW_MS,
  VAT_RATE_PERCENT,
  computeRefund,
  vatIncludedCents,
} from '@shared/constants/policies';
import { CancellationReason } from '@shared/constants/cancellations';
import { TERMS_VERSION } from '@shared/constants/legal';

const now = new Date('2026-06-02T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const TOTAL = 6000;
const FULL = { eligible: true, amountCents: TOTAL, feeCents: 0 };
const NONE = { eligible: false, amountCents: 0, feeCents: 0 };

type Overrides = Partial<Parameters<typeof computeRefund>[0]>;

function refund(overrides: Overrides = {}) {
  return computeRefund({
    startsAt: new Date(now.getTime() + CANCELLATION_WINDOW_MS + HOUR_MS),
    totalAmountCents: TOTAL,
    reason: CancellationReason.CustomerRequest,
    now,
    ...overrides,
  });
}

describe('computeRefund — a pedido del cliente', () => {
  it('devuelve el total con 24 h o más de antelación', () => {
    expect(refund()).toEqual(FULL);
  });

  it('devuelve el total exactamente en el borde de 24 h', () => {
    expect(refund({ startsAt: new Date(now.getTime() + CANCELLATION_WINDOW_MS) })).toEqual(FULL);
  });

  it('no devuelve nada un milisegundo dentro de la ventana', () => {
    expect(refund({ startsAt: new Date(now.getTime() + CANCELLATION_WINDOW_MS - 1) })).toEqual(
      NONE,
    );
  });

  it('no devuelve nada si el tour ya empezó (no presentación)', () => {
    expect(refund({ startsAt: new Date(now.getTime() - HOUR_MS) })).toEqual(NONE);
  });

  it('no es elegible una reserva de monto cero', () => {
    expect(refund({ totalAmountCents: 0 }).eligible).toBe(false);
  });
});

describe('computeRefund — por decisión del operador', () => {
  it.each([
    ['con antelación', {}],
    ['dentro de las 24 h', { startsAt: new Date(now.getTime() + HOUR_MS) }],
    ['con la salida ya empezada', { startsAt: new Date(now.getTime() - HOUR_MS) }],
  ])('reembolsa el total %s', (_case, overrides) => {
    expect(refund({ reason: CancellationReason.OperatorDecision, ...overrides })).toEqual(FULL);
  });
});

describe('vatIncludedCents', () => {
  it('usa la tarifa general del 13 %', () => {
    expect(VAT_RATE_PERCENT).toBe(13);
  });

  it('calcula el IVA incluido del ejemplo de los textos aprobados: USD 6,90 en USD 60,00', () => {
    expect(vatIncludedCents(6000)).toBe(690);
  });

  it('redondea al centavo más cercano', () => {
    // 9000 × 13 / 113 = 1035,39…
    expect(vatIncludedCents(9000)).toBe(1035);
    // 1 × 13 / 113 = 0,115…
    expect(vatIncludedCents(1)).toBe(0);
  });

  it('rechaza montos no enteros o negativos', () => {
    expect(() => vatIncludedCents(-1)).toThrow(RangeError);
    expect(() => vatIncludedCents(10.5)).toThrow(RangeError);
  });
});

describe('versiones de términos', () => {
  it('TERMS_VERSION tiene formato YYYY-MM-DD, sin sufijos', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('computeRefund — fecha inválida', () => {
  it('lanza en lugar de devolver el total', () => {
    expect(() =>
      computeRefund({
        startsAt: new Date(''),
        totalAmountCents: TOTAL,
        reason: CancellationReason.CustomerRequest,
        now,
      }),
    ).toThrow();
  });
});
