import { describe, expect, it } from 'vitest';
import {
  checkoutErrorKey,
  CheckoutErrorKey,
  DeferredCheckoutCode,
  RESTART_CHECKOUT_ERRORS,
} from './deferred-checkout-errors';

describe('checkoutErrorKey', () => {
  it.each([
    ['HOLD_NO_CAPACITY', CheckoutErrorKey.NoAvailability],
    ['HOLD_INSTANCE_UNAVAILABLE', CheckoutErrorKey.NoAvailability],
    ['INSTANCE_UNAVAILABLE', CheckoutErrorKey.NoAvailability],
    ['HOLD_INSTANCE_PAST', CheckoutErrorKey.InstancePast],
    ['INSTANCE_PAST', CheckoutErrorKey.InstancePast],
    ['HOLD_NOT_ACTIVE', CheckoutErrorKey.HoldExpired],
    ['HOLD_SESSION_MISMATCH', CheckoutErrorKey.HoldExpired],
    ['HOLD_NOT_FOUND', CheckoutErrorKey.HoldExpired],
    ['HOLD_SEATS_MISMATCH', CheckoutErrorKey.HoldExpired],
    [DeferredCheckoutCode.HoldInvalid, CheckoutErrorKey.HoldExpired],
    [DeferredCheckoutCode.AmountChanged, CheckoutErrorKey.AmountChanged],
    ['CARD_EXPIRES_BEFORE_DEPARTURE', CheckoutErrorKey.CardExpiresBeforeDeparture],
    ['CARD_DATA_INVALID', CheckoutErrorKey.CardInvalid],
    ['CARD_DATA_MISSING', CheckoutErrorKey.CardInvalid],
    ['HOLD_CUSTOMER_MISMATCH', CheckoutErrorKey.CardInvalid],
    [DeferredCheckoutCode.CardInvalid, CheckoutErrorKey.CardInvalid],
    [DeferredCheckoutCode.CardCustomerMismatch, CheckoutErrorKey.CardInvalid],
  ])('maps %s to %s', (code, expected) => {
    // Act
    const key = checkoutErrorKey(new Error(code));

    // Assert
    expect(key).toBe(expected);
  });

  it.each([new Error('connection reset'), 'not an error', null])(
    'falls back to the generic message for %j',
    (err) => {
      // Act
      const key = checkoutErrorKey(err);

      // Assert
      expect(key).toBe(CheckoutErrorKey.Generic);
    },
  );
});

describe('RESTART_CHECKOUT_ERRORS', () => {
  it('offers starting again only when the hold or the authorized amount is gone', () => {
    // Assert
    expect([...RESTART_CHECKOUT_ERRORS].sort()).toEqual([
      CheckoutErrorKey.AmountChanged,
      CheckoutErrorKey.HoldExpired,
    ]);
  });
});
