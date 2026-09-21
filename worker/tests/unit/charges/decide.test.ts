import { describe, expect, it } from 'vitest';
import {
  decideInFlight,
  decideSweep,
  decideUnpaidCancel,
  IntentStatus,
  intentStatusOf,
  STUCK_PROCESSING_AFTER_MS,
  SweepAction,
  UnpaidCancelAction,
  WatchAction,
  type InFlightTimes,
} from '../../../src/charges/decide.js';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-10-01T12:00:00Z');
const inHours = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS);

// Cobro iniciado hace 1 h, salida en 10 días, sin plazos registrados.
function times(overrides: Partial<InFlightTimes> = {}): InFlightTimes {
  return {
    chargeStartedAt: inHours(-1),
    awaitingActionUntil: null,
    recoveryDeadline: null,
    startsAt: inHours(240),
    ...overrides,
  };
}

describe('intentStatusOf', () => {
  it('maps a 404 (null snapshot) to not_found', () => {
    expect(intentStatusOf(null)).toBe(IntentStatus.NotFound);
  });

  it('keeps the raw status of a snapshot', () => {
    expect(intentStatusOf({ status: IntentStatus.Processing })).toBe(IntentStatus.Processing);
  });
});

describe('decideInFlight — lo que el GET dice que ya pasó', () => {
  it('confirms a succeeded intent even after every deadline passed', () => {
    // Arrange
    const expired = times({ recoveryDeadline: inHours(-1), startsAt: inHours(-1) });

    // Act
    const action = decideInFlight(IntentStatus.Succeeded, expired, NOW);

    // Assert
    expect(action).toBe(WatchAction.Confirm);
  });

  it('waits on a processing intent, even with an expired deadline', () => {
    // Act
    const action = decideInFlight(
      IntentStatus.Processing,
      times({ recoveryDeadline: inHours(-1), startsAt: inHours(-1) }),
      NOW,
    );

    // Assert
    expect(action).toBe(WatchAction.Wait);
  });

  it.each([
    ['waits on a processing intent exactly 24 hours old', 0, WatchAction.Wait],
    ['alerts a processing intent older than 24 hours', 1, WatchAction.AlertStuck],
  ])('%s', (_case, extraMs, expected) => {
    // Arrange
    const chargeStartedAt = new Date(NOW.getTime() - STUCK_PROCESSING_AFTER_MS - extraMs);

    // Act
    const action = decideInFlight(IntentStatus.Processing, times({ chargeStartedAt }), NOW);

    // Assert
    expect(action).toBe(expected);
  });

  it.each(['refunded', 'partially_refunded', 'requires_capture', 'something_new'])(
    'alerts and never acts on an unexpected %s intent',
    (status) => {
      // Act
      const action = decideInFlight(status, times({ recoveryDeadline: inHours(-1) }), NOW);

      // Assert
      expect(action).toBe(WatchAction.AlertUnexpected);
    },
  );
});

describe('decideInFlight — plazos', () => {
  it.each([
    ['registers a 3DS whose deadline was never recorded', null, WatchAction.RegisterAction],
    ['waits while the tourist can still authenticate', inHours(2), WatchAction.Wait],
    [
      'cancels once the authentication deadline passed',
      inHours(-1),
      WatchAction.CancelActionExpired,
    ],
    ['cancels at the exact authentication deadline', NOW, WatchAction.CancelActionExpired],
  ])('%s', (_case, awaitingActionUntil, expected) => {
    // Act
    const action = decideInFlight(IntentStatus.RequiresAction, times({ awaitingActionUntil }), NOW);

    // Assert
    expect(action).toBe(expected);
  });

  it.each([
    ['records a retryable decline before the deadline', inHours(5), WatchAction.RecordRetryable],
    ['records a decline when no deadline exists yet', null, WatchAction.RecordRetryable],
    ['cancels a decline once the deadline passed', inHours(-1), WatchAction.CancelRecoveryExpired],
    ['cancels a decline at the exact deadline', NOW, WatchAction.CancelRecoveryExpired],
  ])('%s', (_case, recoveryDeadline, expected) => {
    // Act
    const action = decideInFlight(
      IntentStatus.RequiresPaymentMethod,
      times({ recoveryDeadline }),
      NOW,
    );

    // Assert
    expect(action).toBe(expected);
  });

  it('cancels an unregistered 3DS whose recovery deadline already passed instead of sending a dead link', () => {
    // Act
    const action = decideInFlight(
      IntentStatus.RequiresAction,
      times({ recoveryDeadline: inHours(-1) }),
      NOW,
    );

    // Assert
    expect(action).toBe(WatchAction.CancelRecoveryExpired);
  });

  it.each([IntentStatus.RequiresAction, IntentStatus.RequiresPaymentMethod, IntentStatus.Canceled])(
    'cancels a %s charge once the departure started',
    (status) => {
      // Act
      const action = decideInFlight(
        status,
        times({ startsAt: inHours(-1), awaitingActionUntil: inHours(2) }),
        NOW,
      );

      // Assert
      expect(action).toBe(WatchAction.CancelDepartureStarted);
    },
  );

  it('treats a departure starting exactly now as started', () => {
    // Act
    const action = decideInFlight(
      IntentStatus.RequiresPaymentMethod,
      times({ startsAt: NOW }),
      NOW,
    );

    // Assert
    expect(action).toBe(WatchAction.CancelDepartureStarted);
  });
});

describe('decideInFlight — intents cerrados', () => {
  it.each([IntentStatus.Canceled, IntentStatus.Failed, IntentStatus.NotFound])(
    'records a %s intent as terminal so a new one can be created',
    (status) => {
      // Act
      const action = decideInFlight(status, times({ recoveryDeadline: inHours(5) }), NOW);

      // Assert
      expect(action).toBe(WatchAction.RecordTerminal);
    },
  );

  it('cancels instead of recording a closed intent once the recovery deadline passed', () => {
    // Act
    const action = decideInFlight(
      IntentStatus.Failed,
      times({ recoveryDeadline: inHours(-1) }),
      NOW,
    );

    // Assert
    expect(action).toBe(WatchAction.CancelRecoveryExpired);
  });
});

describe('decideSweep', () => {
  it.each([
    [IntentStatus.Succeeded, SweepAction.Confirm],
    [IntentStatus.RequiresAction, SweepAction.Cancel],
    [IntentStatus.RequiresPaymentMethod, SweepAction.Cancel],
    [IntentStatus.Canceled, SweepAction.MarkClosed],
    [IntentStatus.Failed, SweepAction.MarkClosed],
    [IntentStatus.NotFound, SweepAction.MarkClosed],
    [IntentStatus.Processing, SweepAction.Wait],
    ['refunded', SweepAction.AlertUnexpected],
  ])('maps a %s intent to %s', (status, expected) => {
    // Act
    const action = decideSweep(status);

    // Assert
    expect(action).toBe(expected);
  });
});

describe('decideUnpaidCancel', () => {
  it.each([
    [IntentStatus.Succeeded, UnpaidCancelAction.Settle],
    [IntentStatus.Processing, UnpaidCancelAction.Wait],
    [IntentStatus.RequiresAction, UnpaidCancelAction.Cancel],
    [IntentStatus.RequiresPaymentMethod, UnpaidCancelAction.Cancel],
    [IntentStatus.Canceled, UnpaidCancelAction.Cancel],
    [IntentStatus.Failed, UnpaidCancelAction.Cancel],
    [IntentStatus.NotFound, UnpaidCancelAction.Cancel],
    ['refunded', UnpaidCancelAction.AlertUnexpected],
  ])('maps a %s intent to %s before cancelling an unpaid booking', (status, expected) => {
    // Act
    const action = decideUnpaidCancel(status);

    // Assert
    expect(action).toBe(expected);
  });
});
