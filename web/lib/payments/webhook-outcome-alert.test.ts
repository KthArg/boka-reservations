import { describe, expect, it } from 'vitest';
import { ConfirmBookingOutcome } from '@shared/constants/enums';
import { webhookOutcomeAlert } from './webhook-outcome-alert';

describe('webhookOutcomeAlert', () => {
  it.each([ConfirmBookingOutcome.Confirmed, ConfirmBookingOutcome.AlreadyProcessed])(
    'does not alert on %s',
    (outcome) => {
      // Act
      const alert = webhookOutcomeAlert(outcome);

      // Assert
      expect(alert).toBeNull();
    },
  );

  it.each([
    [ConfirmBookingOutcome.DuplicatePayment, 'webhook-duplicate-payment'],
    [ConfirmBookingOutcome.LatePaymentRefundBlocked, 'webhook-late-payment-refund-blocked'],
    [ConfirmBookingOutcome.PaymentMismatch, 'webhook-payment-mismatch'],
  ])('alerts money that needs manual action (%s) with level error', (outcome, fingerprint) => {
    // Act
    const alert = webhookOutcomeAlert(outcome);

    // Assert
    expect(alert).toMatchObject({ fingerprint, level: 'error' });
  });

  it.each([
    [ConfirmBookingOutcome.OverbookedRefunded, 'booking-overbooked-refunded'],
    [ConfirmBookingOutcome.LatePaymentRefunded, 'webhook-late-payment-refunded'],
    [ConfirmBookingOutcome.ConfirmedUnclaimed, 'webhook-confirmed-unclaimed'],
    [ConfirmBookingOutcome.Ignored, 'webhook-ignored-status'],
  ])('alerts %s with level warning', (outcome, fingerprint) => {
    // Act
    const alert = webhookOutcomeAlert(outcome);

    // Assert
    expect(alert).toMatchObject({ fingerprint, level: 'warning' });
  });

  it.each([null, 'something_new', 'toString'])(
    'never swallows an unknown outcome (%s)',
    (outcome) => {
      // Act
      const alert = webhookOutcomeAlert(outcome);

      // Assert
      expect(alert).toMatchObject({ fingerprint: 'webhook-unknown-outcome', level: 'error' });
    },
  );
});
