// Plazo que los correos de cobro rechazado y de 3DS le prometen al turista: nunca más allá del
// momento en que el ciclo de la salida la suelta y la cancela (prueba en producción, 2026-10-01).
import { describe, expect, it } from 'vitest';
import { promisedDeadline } from '../../../src/notifications/deferred-repository.js';

const NOW = new Date('2026-10-01T12:00:00Z');
const BOOKING_DEADLINE = '2026-10-04T14:00:00Z';

describe('promisedDeadline', () => {
  it('keeps the booking deadline when the departure has no open cycle', () => {
    expect(promisedDeadline(BOOKING_DEADLINE, null, NOW)).toBe(BOOKING_DEADLINE);
  });

  it('promises the cycle deadline when it comes first', () => {
    const cycle = '2026-10-03T15:50:00Z';
    expect(promisedDeadline(BOOKING_DEADLINE, cycle, NOW)).toBe(cycle);
  });

  it('keeps the booking deadline when it comes before the cycle deadline', () => {
    expect(promisedDeadline(BOOKING_DEADLINE, '2026-10-05T00:00:00Z', NOW)).toBe(BOOKING_DEADLINE);
  });

  // Vencido el ciclo, la salida espera a una persona y la reserva sigue viva hasta su plazo.
  it('ignores a cycle deadline that already passed', () => {
    expect(promisedDeadline(BOOKING_DEADLINE, '2026-10-01T11:00:00Z', NOW)).toBe(BOOKING_DEADLINE);
  });
});
