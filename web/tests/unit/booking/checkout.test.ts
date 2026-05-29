import { describe, it, expect } from 'vitest';
import { calculateTotalCents } from '@/lib/booking/create';
import type { PricingRow } from '@/lib/booking/create';

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
    expect(cents).toBe(10000); // 3 * 33.333 = 99.999 → * 100 = 9999.9 → round = 10000
  });

  it('devuelve 0 con pricing vacío', () => {
    expect(calculateTotalCents({ adult: 5, child: 5, student: 5 }, [])).toBe(0);
  });
});
