import { describe, expect, it } from 'vitest';
import {
  isCustomerCleanupDue,
  type CleanupBooking,
  type CleanupCandidateView,
} from '../../../src/charges/cleanup-decision.js';

const NOW = new Date('2026-10-01T12:00:00Z');
const PAST = '2026-09-30T12:00:00Z';
const FUTURE = '2026-10-10T12:00:00Z';

function booking(overrides: Partial<CleanupBooking> = {}): CleanupBooking {
  return { status: 'cancelled', startsAt: FUTURE, payments: [], ...overrides };
}

function candidate(overrides: Partial<CleanupCandidateView> = {}): CleanupCandidateView {
  return { holdStatus: 'released', bookings: [], ...overrides };
}

describe('isCustomerCleanupDue', () => {
  it.each(['expired', 'released'])(
    'cleans the customer of an abandoned %s checkout',
    (holdStatus) => {
      // Act
      const due = isCustomerCleanupDue(candidate({ holdStatus }), NOW);

      // Assert
      expect(due).toBe(true);
    },
  );

  it('keeps a converted hold without bookings', () => {
    // Act
    const due = isCustomerCleanupDue(candidate({ holdStatus: 'converted' }), NOW);

    // Assert
    expect(due).toBe(false);
  });

  it.each(['cancelled', 'refunded', 'overbooked_refunded'])(
    'cleans the customer of a %s booking with every intent closed',
    (status) => {
      // Arrange
      const closed = booking({ status, payments: [{ status: 'failed', providerClosedAt: PAST }] });

      // Act
      const due = isCustomerCleanupDue(candidate({ bookings: [closed] }), NOW);

      // Assert
      expect(due).toBe(true);
    },
  );

  it.each([
    ['a pending payment', { status: 'pending', providerClosedAt: null }],
    ['a failed payment without closure', { status: 'failed', providerClosedAt: null }],
  ])('keeps the customer while a cancelled booking has %s', (_case, payment) => {
    // Act
    const due = isCustomerCleanupDue(
      candidate({ bookings: [booking({ payments: [payment] })] }),
      NOW,
    );

    // Assert
    expect(due).toBe(false);
  });

  it.each([
    ['before the departure', FUTURE, false],
    ['once the departure started', PAST, true],
  ])('handles a confirmed booking %s', (_case, startsAt, expected) => {
    // Arrange
    const confirmed = booking({
      status: 'confirmed',
      startsAt,
      payments: [{ status: 'succeeded', providerClosedAt: null }],
    });

    // Act
    const due = isCustomerCleanupDue(
      candidate({ holdStatus: 'converted', bookings: [confirmed] }),
      NOW,
    );

    // Assert
    expect(due).toBe(expected);
  });

  it.each(['pending_minimum', 'pending_payment', 'payment_mismatch'])(
    'keeps the customer of a %s booking',
    (status) => {
      // Act
      const due = isCustomerCleanupDue(candidate({ bookings: [booking({ status })] }), NOW);

      // Assert
      expect(due).toBe(false);
    },
  );
});
