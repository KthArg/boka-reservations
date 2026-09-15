import { beforeEach, describe, expect, it, vi } from 'vitest';

// Alerta por outcome de confirm_booking al asentar un cobro (spec 0029 §5.3, §5.6). Sentry es un
// servicio externo: se simula para leer nivel y fingerprint.
const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  setLevel: vi.fn(),
  setFingerprint: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  captureMessage: sentry.captureMessage,
  withScope: (cb: (scope: unknown) => void) =>
    cb({ setLevel: sentry.setLevel, setFingerprint: sentry.setFingerprint, setExtra: vi.fn() }),
}));

const { __testing } = await import('../../../src/charges/settle.js');
const { alertForOutcome } = __testing;

const SOURCE = 'watch-charges';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settle — alerta por outcome', () => {
  it.each(['confirmed', 'already_processed'] as const)('stays silent on %s', (outcome) => {
    // Act
    alertForOutcome(outcome, 'b1', SOURCE);

    // Assert
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['duplicate_payment', 'watch-charges-duplicate-payment'],
    ['late_payment_refund_blocked', 'watch-charges-late-payment-refund-blocked'],
    ['payment_mismatch', 'watch-charges-mismatch'],
    ['ignored', 'watch-charges-ignored'],
  ] as const)('alerts %s with level error', (outcome, fingerprint) => {
    // Act
    alertForOutcome(outcome, 'b1', SOURCE);

    // Assert
    expect(sentry.setLevel).toHaveBeenCalledWith('error');
    expect(sentry.setFingerprint).toHaveBeenCalledWith([fingerprint]);
  });

  it.each([
    ['confirmed_unclaimed', 'watch-charges-confirmed-unclaimed'],
    ['late_payment_refunded', 'watch-charges-late-payment-refunded'],
    ['overbooked_refunded', 'watch-charges-overbooked-refunded'],
  ] as const)('alerts %s with level warning', (outcome, fingerprint) => {
    // Act
    alertForOutcome(outcome, 'b1', SOURCE);

    // Assert
    expect(sentry.setLevel).toHaveBeenCalledWith('warning');
    expect(sentry.setFingerprint).toHaveBeenCalledWith([fingerprint]);
  });

  it('alerts a null outcome as money that could not be settled', () => {
    // Act
    alertForOutcome(null, 'b1', SOURCE);

    // Assert
    expect(sentry.setLevel).toHaveBeenCalledWith('error');
    expect(sentry.setFingerprint).toHaveBeenCalledWith(['watch-charges-ignored']);
  });

  it('never swallows an outcome the worker does not know', () => {
    // Act
    alertForOutcome('something_new' as never, 'b1', SOURCE);

    // Assert
    expect(sentry.setLevel).toHaveBeenCalledWith('error');
    expect(sentry.setFingerprint).toHaveBeenCalledWith([
      'watch-charges-unknown-outcome-something_new',
    ]);
  });
});
