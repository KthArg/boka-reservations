import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentIntentOutcome } from '../../../src/reconciliation/onvopay.js';

vi.mock('../../../src/env.js', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    APP_URL: 'http://localhost:3000',
    ONVOPAY_SECRET_KEY: 'onvo_test',
    NODE_ENV: 'test',
  },
}));

const repoMocks = vi.hoisted(() => ({
  fetchStalePendingBookings: vi.fn(),
  cancelStaleBooking: vi.fn(),
  confirmRecoveredBooking: vi.fn(),
  writeRecoveredAudit: vi.fn(),
}));
vi.mock('../../../src/reconciliation/repository.js', () => repoMocks);

const sentryMocks = vi.hoisted(() => ({ captureMessage: vi.fn(), setFingerprint: vi.fn() }));
vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  captureMessage: sentryMocks.captureMessage,
  withScope: (cb: (scope: unknown) => void) =>
    cb({ setLevel: vi.fn(), setFingerprint: sentryMocks.setFingerprint, setExtra: vi.fn() }),
}));

import { __testing } from '../../../src/jobs/reconcile-pending-payments.js';
const { reconcileOne } = __testing;

const db = {} as never;
const FRESH = new Date().toISOString();
const OLD_36H = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

type Outcome = { outcome: PaymentIntentOutcome; rawStatus: string };
function client(result: Outcome) {
  return { getPaymentIntent: vi.fn().mockResolvedValue(result) } as never;
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    tickets_adult: 2,
    tickets_child: 1,
    tickets_student: 0,
    created_at: FRESH,
    payments: [{ external_payment_id: 'pi_x', status: 'pending' }],
    ...overrides,
  } as never;
}

describe('reconcileOne — árbol de decisión', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin fila de pago: cancela con reason no_payment y no consulta OnvoPay', async () => {
    const c = client({ outcome: PaymentIntentOutcome.Paid, rawStatus: 'succeeded' });

    await reconcileOne(db, c, booking({ payments: [] }));

    expect(repoMocks.cancelStaleBooking).toHaveBeenCalledWith(db, 'b1', 'no_payment');
    expect(
      (c as { getPaymentIntent: ReturnType<typeof vi.fn> }).getPaymentIntent,
    ).not.toHaveBeenCalled();
    expect(repoMocks.confirmRecoveredBooking).not.toHaveBeenCalled();
  });

  it('con pago pero sin cliente OnvoPay: no cancela ni confirma (nunca a ciegas)', async () => {
    await reconcileOne(db, null, booking());

    expect(repoMocks.cancelStaleBooking).not.toHaveBeenCalled();
    expect(repoMocks.confirmRecoveredBooking).not.toHaveBeenCalled();
  });

  it('OnvoPay succeeded: recupera (confirm + audit) y alerta a Sentry', async () => {
    const c = client({ outcome: PaymentIntentOutcome.Paid, rawStatus: 'succeeded' });

    await reconcileOne(db, c, booking());

    expect(repoMocks.confirmRecoveredBooking).toHaveBeenCalledWith(db, 'b1', 'pi_x', 3);
    expect(repoMocks.writeRecoveredAudit).toHaveBeenCalledWith(db, 'b1');
    expect(sentryMocks.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith(['reconcile-recovered']);
    expect(repoMocks.cancelStaleBooking).not.toHaveBeenCalled();
  });

  it('OnvoPay canceled: cancela con el estado crudo como reason', async () => {
    const c = client({ outcome: PaymentIntentOutcome.NotPaid, rawStatus: 'canceled' });

    await reconcileOne(db, c, booking());

    expect(repoMocks.cancelStaleBooking).toHaveBeenCalledWith(db, 'b1', 'canceled');
    expect(repoMocks.confirmRecoveredBooking).not.toHaveBeenCalled();
  });

  it('OnvoPay processing y reciente: no toca la reserva ni alerta', async () => {
    const c = client({ outcome: PaymentIntentOutcome.Pending, rawStatus: 'processing' });

    await reconcileOne(db, c, booking());

    expect(repoMocks.cancelStaleBooking).not.toHaveBeenCalled();
    expect(repoMocks.confirmRecoveredBooking).not.toHaveBeenCalled();
    expect(sentryMocks.captureMessage).not.toHaveBeenCalled();
  });

  it('OnvoPay processing estancado >24h: alerta para revisión manual, no cancela', async () => {
    const c = client({ outcome: PaymentIntentOutcome.Pending, rawStatus: 'processing' });

    await reconcileOne(db, c, booking({ created_at: OLD_36H }));

    expect(sentryMocks.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith(['reconcile-stuck-processing']);
    expect(repoMocks.cancelStaleBooking).not.toHaveBeenCalled();
  });
});
