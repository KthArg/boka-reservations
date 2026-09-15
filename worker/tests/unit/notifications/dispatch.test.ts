import { describe, expect, it } from 'vitest';
import { preparerFor } from '../../../src/notifications/dispatch.js';
import { prepareBookingEmail } from '../../../src/notifications/prepare.js';
import { prepareCancellationEmail } from '../../../src/notifications/prepare-cancellation.js';
import {
  prepareChargeActionEmail,
  prepareRequiresActionEmail,
  prepareReservedEmail,
} from '../../../src/notifications/prepare-deferred.js';

// Despacho explícito por kind (spec 0029): ningún kind cae en la plantilla de reserva confirmada.

describe('preparerFor', () => {
  it.each([
    ['booking_confirmation', prepareBookingEmail],
    ['reminder_24h', prepareBookingEmail],
    ['cancellation_confirmation', prepareCancellationEmail],
    ['booking_reserved', prepareReservedEmail],
    ['charge_failed_action_required_1', prepareChargeActionEmail],
    ['charge_failed_action_required_2', prepareChargeActionEmail],
    ['charge_failed_action_required_3', prepareChargeActionEmail],
    ['charge_requires_action', prepareRequiresActionEmail],
  ])('sends %s with its own preparer', (kind, expected) => {
    // Act
    const preparer = preparerFor(kind);

    // Assert
    expect(preparer).toBe(expected);
  });

  it.each(['guide_assignment', 'refund_confirmation', 'overbooked_refunded'])(
    'keeps a preparer for the existing kind %s',
    (kind) => {
      // Act
      const preparer = preparerFor(kind);

      // Assert
      expect(preparer).toBeTypeOf('function');
    },
  );

  it.each(['departure_cancelled_minimum', 'something_new', 'toString'])(
    'has no preparer for %s, which this worker cannot send yet',
    (kind) => {
      // Act
      const preparer = preparerFor(kind);

      // Assert
      expect(preparer).toBeNull();
    },
  );
});
