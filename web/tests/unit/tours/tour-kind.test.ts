import { describe, expect, it } from 'vitest';
import { isTourKind } from '@shared/constants/enums';

// Parámetro de las rutas /tours/[kind] y /dashboard/tours/[kind] (spec 0047): solo los dos tours.
describe('isTourKind', () => {
  it.each(['day', 'night'])('accepts %s', (value) => {
    expect(isTourKind(value)).toBe(true);
  });

  it.each(['', 'Day', 'both', 'cerro-chompipe', 'day/'])('rejects %j', (value) => {
    expect(isTourKind(value)).toBe(false);
  });
});
