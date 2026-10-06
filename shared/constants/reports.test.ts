import { describe, expect, it } from 'vitest';
import { RevenueBasis, parseRevenueBasis } from './reports';

// Spec 0046: el criterio llega de la URL; cualquier cosa rara es la fecha de pago.
describe('parseRevenueBasis', () => {
  it('accepts the departure basis', () => {
    expect(parseRevenueBasis('departure')).toBe(RevenueBasis.Departure);
  });

  it.each([undefined, null, '', 'payment', 'DEPARTURE', 'x'])(
    'falls back to payment for %j',
    (raw) => {
      expect(parseRevenueBasis(raw)).toBe(RevenueBasis.Payment);
    },
  );
});
