import { describe, expect, it } from 'vitest';
import { ManualChargeOutcome, outcomeForStart } from './manual-charge-outcomes';

describe('outcomeForStart', () => {
  it.each([
    ['not_chargeable', ManualChargeOutcome.NotChargeable],
    ['retry_too_soon', ManualChargeOutcome.TooSoon],
    ['departure_unavailable', ManualChargeOutcome.DepartureUnavailable],
    ['recovery_expired', ManualChargeOutcome.RecoveryExpired],
    ['payment_method_changed', ManualChargeOutcome.CardChanged],
    ['intent_mismatch', ManualChargeOutcome.Review],
  ])('maps charge_booking_start %s to %s', (startOutcome, expected) => {
    // Act
    const outcome = outcomeForStart(startOutcome);

    // Assert
    expect(outcome).toBe(expected);
  });

  it('sends an outcome the panel does not know to manual review', () => {
    // Act
    const outcome = outcomeForStart('something_new');

    // Assert
    expect(outcome).toBe(ManualChargeOutcome.Review);
  });
});
