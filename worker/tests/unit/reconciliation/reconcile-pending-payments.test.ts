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

// createClient construye un RealtimeClient que lanza en Node < 22 sin WebSocket
// nativo (CI corre en Node 20). El job nunca usa el cliente de verdad acá (el
// repository está mockeado), así que se stubea su construcción.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({})),
}));

const repoMocks = vi.hoisted(() => ({
  fetchStalePendingBookings: vi.fn(),
  cancelStaleBooking: vi.fn(),
  confirmRecoveredBooking: vi.fn(),
  flagPaymentMismatch: vi.fn(),
  writeRecoveredAudit: vi.fn(),
  // spec 0023: lectura de capacidad para detectar sobrecupo. Default null = sin alerta.
  fetchInstanceCapacity: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../src/reconciliation/repository.js', () => repoMocks);

const sentryMocks = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  setFingerprint: vi.fn(),
}));
vi.mock('@sentry/node', () => ({
  captureException: sentryMocks.captureException,
  captureMessage: sentryMocks.captureMessage,
  withScope: (cb: (scope: unknown) => void) =>
    cb({ setLevel: vi.fn(), setFingerprint: sentryMocks.setFingerprint, setExtra: vi.fn() }),
}));

import {
  reconcilePendingPayments,
  __testing,
} from '../../../src/jobs/reconcile-pending-payments.js';
const { reconcileOne } = __testing;

const db = {} as never;
const FRESH = new Date().toISOString();
const OLD_36H = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

const EXPECTED_CENTS = 5000;
const EXPECTED_CURRENCY = 'USD';

type Outcome = {
  outcome: PaymentIntentOutcome;
  rawStatus: string;
  amountCents?: number;
  currency?: string;
};
function client(result: Outcome) {
  return { getPaymentIntent: vi.fn().mockResolvedValue(result) } as never;
}

// Resultado de OnvoPay 'succeeded' con monto que coincide con el esperado del fixture.
const paidMatching: Outcome = {
  outcome: PaymentIntentOutcome.Paid,
  rawStatus: 'succeeded',
  amountCents: EXPECTED_CENTS,
  currency: EXPECTED_CURRENCY,
};

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    tickets_adult: 2,
    tickets_child: 1,
    tickets_student: 0,
    created_at: FRESH,
    payments: [
      {
        external_payment_id: 'pi_x',
        status: 'pending',
        amount_cents: EXPECTED_CENTS,
        currency: EXPECTED_CURRENCY,
      },
    ],
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

  it('OnvoPay succeeded con monto coincidente: recupera (confirm + audit) y alerta', async () => {
    const c = client(paidMatching);

    await reconcileOne(db, c, booking());

    expect(repoMocks.confirmRecoveredBooking).toHaveBeenCalledWith(db, 'b1', 'pi_x', 3);
    expect(repoMocks.writeRecoveredAudit).toHaveBeenCalledWith(db, 'b1', {
      seats: 3,
      external_payment_id: 'pi_x',
    });
    expect(sentryMocks.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith(['reconcile-recovered']);
    expect(repoMocks.cancelStaleBooking).not.toHaveBeenCalled();
    expect(repoMocks.flagPaymentMismatch).not.toHaveBeenCalled();
  });

  it('OnvoPay succeeded con monto distinto: marca payment_mismatch (no confirma) y alerta', async () => {
    const c = client({ ...paidMatching, amountCents: EXPECTED_CENTS + 100 });

    await reconcileOne(db, c, booking());

    expect(repoMocks.flagPaymentMismatch).toHaveBeenCalledWith(
      db,
      'b1',
      EXPECTED_CENTS + 100,
      EXPECTED_CURRENCY,
    );
    expect(repoMocks.confirmRecoveredBooking).not.toHaveBeenCalled();
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith(['reconcile-payment-mismatch']);
  });

  it('OnvoPay succeeded con moneda distinta: también marca payment_mismatch', async () => {
    const c = client({ ...paidMatching, currency: 'CRC' });

    await reconcileOne(db, c, booking());

    expect(repoMocks.flagPaymentMismatch).toHaveBeenCalledWith(db, 'b1', EXPECTED_CENTS, 'CRC');
    expect(repoMocks.confirmRecoveredBooking).not.toHaveBeenCalled();
  });

  it('OnvoPay succeeded sin monto en el GET: no verificable, saltea sin tocar la reserva', async () => {
    const c = client({ outcome: PaymentIntentOutcome.Paid, rawStatus: 'succeeded' });

    await reconcileOne(db, c, booking());

    expect(repoMocks.confirmRecoveredBooking).not.toHaveBeenCalled();
    expect(repoMocks.flagPaymentMismatch).not.toHaveBeenCalled();
    expect(repoMocks.cancelStaleBooking).not.toHaveBeenCalled();
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith(['reconcile-amount-unverifiable']);
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

describe('reconcilePendingPayments — aislamiento de fallos en el lote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('un fallo en una reserva no aborta el lote: la siguiente se procesa y se reporta a Sentry', async () => {
    const noPayment = (id: string) => ({
      id,
      tickets_adult: 1,
      tickets_child: 0,
      tickets_student: 0,
      created_at: FRESH,
      payments: [],
    });
    repoMocks.fetchStalePendingBookings.mockResolvedValue([noPayment('a'), noPayment('b')]);
    repoMocks.cancelStaleBooking
      .mockRejectedValueOnce(new Error('db transitorio'))
      .mockResolvedValueOnce(true);

    await reconcilePendingPayments();

    // La reserva 'b' se procesó pese al fallo de 'a'; el fallo se reportó.
    expect(repoMocks.cancelStaleBooking).toHaveBeenCalledTimes(2);
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
  });
});
