import { describe, it, expect } from 'vitest';
import { computeRefund, CANCELLATION_WINDOW_MS } from '@shared/constants/policies';

const now = new Date('2026-06-02T12:00:00.000Z');
const TOTAL = 8000;

describe('computeRefund', () => {
  it('grants a full refund when cancelling well before the window', () => {
    const startsAt = new Date(now.getTime() + CANCELLATION_WINDOW_MS + 60 * 60 * 1000);

    const result = computeRefund({ startsAt, totalAmountCents: TOTAL, now });

    expect(result).toEqual({ eligible: true, amountCents: TOTAL });
  });

  it('grants a full refund exactly at the 24h boundary', () => {
    const startsAt = new Date(now.getTime() + CANCELLATION_WINDOW_MS);

    const result = computeRefund({ startsAt, totalAmountCents: TOTAL, now });

    expect(result).toEqual({ eligible: true, amountCents: TOTAL });
  });

  it('denies refund one millisecond inside the window', () => {
    const startsAt = new Date(now.getTime() + CANCELLATION_WINDOW_MS - 1);

    const result = computeRefund({ startsAt, totalAmountCents: TOTAL, now });

    expect(result).toEqual({ eligible: false, amountCents: 0 });
  });

  it('denies refund when the tour already started', () => {
    const startsAt = new Date(now.getTime() - 60 * 60 * 1000);

    const result = computeRefund({ startsAt, totalAmountCents: TOTAL, now });

    expect(result).toEqual({ eligible: false, amountCents: 0 });
  });
});
