import { describe, expect, it } from 'vitest';
import { totp } from '../integration/mfa-fixtures';

// Vectores de RFC 6238 (apéndice B), SHA-1: clave ASCII "12345678901234567890" en base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const EIGHT_DIGITS = 8;
const MS = 1000;

describe('totp (helper de los tests de integración)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches RFC 6238 at T=%i', (seconds, expected) => {
    expect(totp(RFC_SECRET, seconds * MS, EIGHT_DIGITS)).toBe(expected);
  });

  it('gives six digits by default', () => {
    expect(totp(RFC_SECRET, 59 * MS)).toBe('287082');
  });
});
