import { describe, it, expect } from 'vitest';
import {
  calculateTotalCents,
  computeAuthoritativeTotal,
  initialQuantities,
} from '@/lib/booking/pricing-math';
import type { PricingRow } from '@/lib/booking/pricing-math';

const pricing: PricingRow[] = [
  { ticket_type: 'adult', price_usd: 50 },
  { ticket_type: 'child', price_usd: 25 },
  { ticket_type: 'student', price_usd: 35 },
];

describe('calculateTotalCents', () => {
  it('calcula correctamente con un adulto', () => {
    expect(calculateTotalCents({ adult: 1, child: 0, student: 0 }, pricing)).toBe(5000);
  });

  it('calcula correctamente con combinación de tickets', () => {
    expect(calculateTotalCents({ adult: 2, child: 1, student: 0 }, pricing)).toBe(12500);
  });

  it('devuelve 0 cuando todos los campos son 0', () => {
    expect(calculateTotalCents({ adult: 0, child: 0, student: 0 }, pricing)).toBe(0);
  });

  it('ignora ticket_type sin precio en el pricing', () => {
    const partialPricing: PricingRow[] = [{ ticket_type: 'adult', price_usd: 100 }];
    expect(calculateTotalCents({ adult: 1, child: 2, student: 1 }, partialPricing)).toBe(10000);
  });

  it('redondea centavos correctamente', () => {
    const oddPricing: PricingRow[] = [{ ticket_type: 'adult', price_usd: 33.333 }];
    const cents = calculateTotalCents({ adult: 3, child: 0, student: 0 }, oddPricing);
    expect(Number.isInteger(cents)).toBe(true);
    // Cada tiquete se cobra en centavos enteros (spec 0040): 33.333 → 3333 × 3 = 9999. La base
    // guarda numeric(10,2), así que un precio real nunca tiene tres decimales.
    expect(cents).toBe(9999);
  });

  it('devuelve 0 con pricing vacío', () => {
    expect(calculateTotalCents({ adult: 5, child: 5, student: 5 }, [])).toBe(0);
  });
});

describe('computeAuthoritativeTotal', () => {
  it('calcula el total desde los precios de la DB', () => {
    expect(computeAuthoritativeTotal({ adult: 2, child: 1, student: 0 }, pricing)).toBe(12500);
  });

  it('lanza si un tipo pedido (cantidad > 0) no tiene precio activo (no cobra 0)', () => {
    const onlyAdult: PricingRow[] = [{ ticket_type: 'adult', price_usd: 50 }];
    expect(() => computeAuthoritativeTotal({ adult: 1, child: 2, student: 0 }, onlyAdult)).toThrow(
      'CHECKOUT_TICKET_UNAVAILABLE',
    );
  });

  it('no lanza por un tipo sin precio si su cantidad es 0', () => {
    const onlyAdult: PricingRow[] = [{ ticket_type: 'adult', price_usd: 50 }];
    expect(computeAuthoritativeTotal({ adult: 2, child: 0, student: 0 }, onlyAdult)).toBe(10000);
  });

  it('lanza CHECKOUT_ZERO_AMOUNT si el total da 0 (precio configurado en 0)', () => {
    const freeAdult: PricingRow[] = [{ ticket_type: 'adult', price_usd: 0 }];
    expect(() => computeAuthoritativeTotal({ adult: 1, child: 0, student: 0 }, freeAdult)).toThrow(
      'CHECKOUT_ZERO_AMOUNT',
    );
  });
});

describe('centavos enteros y cantidades iniciales (spec 0040)', () => {
  it('suma cada precio en centavos enteros (sin correr un centavo)', () => {
    expect(
      calculateTotalCents({ adult: 3, child: 0, student: 0 }, [
        { ticket_type: 'adult', price_usd: 19.99 },
      ]),
    ).toBe(5997);
  });

  it('arranca con un adulto si el día tiene precio de adulto', () => {
    expect(initialQuantities(pricing)).toEqual({ adult: 1, child: 0, student: 0 });
  });

  it('sin precio de adulto ese día, arranca con otro tiquete que sí tiene precio', () => {
    expect(initialQuantities([{ ticket_type: 'child' }])).toEqual({
      adult: 0,
      child: 1,
      student: 0,
    });
    expect(initialQuantities([])).toEqual({ adult: 0, child: 0, student: 0 });
  });
});
