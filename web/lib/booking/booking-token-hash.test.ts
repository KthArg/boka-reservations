import { describe, it, expect } from 'vitest';
import { hashBookingToken } from './booking-token-hash';

describe('hashBookingToken', () => {
  it('is deterministic for the same input', () => {
    expect(hashBookingToken('abc123')).toBe(hashBookingToken('abc123'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashBookingToken('abc123')).not.toBe(hashBookingToken('abc124'));
  });

  it('produces a 64-char hex sha-256 digest', () => {
    expect(hashBookingToken('abc123')).toMatch(/^[0-9a-f]{64}$/);
  });
});
