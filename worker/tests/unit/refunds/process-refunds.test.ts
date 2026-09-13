import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  fetchActiveRefunds: vi.fn(),
  loadPaymentIntentId: vi.fn(),
  claimForProcessing: vi.fn(),
  releaseClaim: vi.fn(),
  markProcessing: vi.fn(),
  markSucceeded: vi.fn(),
  markFailed: vi.fn(),
}));
vi.mock('../../../src/refunds/repository.js', () => repoMocks);

import { __testing } from '../../../src/jobs/process-refunds.js';
const { processOne } = __testing;

const db = {} as never;

function client(overrides: Partial<{ createRefund: unknown; getRefund: unknown }> = {}) {
  return {
    createRefund: vi.fn().mockResolvedValue({ externalRefundId: 'ref_1', status: 'pending' }),
    getRefund: vi.fn().mockResolvedValue({ externalRefundId: 'ref_1', status: 'pending' }),
    ...overrides,
  } as never;
}

const FRESH = new Date().toISOString();
const OLD = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

const pending = {
  id: 'r1',
  booking_id: 'b1',
  payment_id: 'p1',
  external_refund_id: null,
  amount_cents: 9000,
  currency: 'USD',
  status: 'pending' as const,
  attempts: 0,
  created_at: FRESH,
  updated_at: FRESH,
};

describe('process-refunds processOne', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoMocks.loadPaymentIntentId.mockResolvedValue('pi_123');
    // Por defecto el claim lo gana este ciclo.
    repoMocks.claimForProcessing.mockResolvedValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('reclama la fila y crea el refund en OnvoPay marcándolo processing', async () => {
    const c = client();

    await processOne(db, c, pending);

    expect(repoMocks.claimForProcessing).toHaveBeenCalledWith(db, 'r1', 1);
    expect((c as { createRefund: ReturnType<typeof vi.fn> }).createRefund).toHaveBeenCalledWith({
      externalPaymentId: 'pi_123',
      amountCents: 9000,
    });
    expect(repoMocks.markProcessing).toHaveBeenCalledWith(db, 'r1', 'ref_1', 1);
    expect(repoMocks.markSucceeded).not.toHaveBeenCalled();
  });

  it('single-flight: si otro ciclo ya reclamó la fila, no llama a OnvoPay', async () => {
    repoMocks.claimForProcessing.mockResolvedValue(false);
    const c = client();

    await processOne(db, c, pending);

    expect((c as { createRefund: ReturnType<typeof vi.fn> }).createRefund).not.toHaveBeenCalled();
    expect(repoMocks.markProcessing).not.toHaveBeenCalled();
    expect(repoMocks.markFailed).not.toHaveBeenCalled();
  });

  it('si OnvoPay resuelve succeeded de inmediato, lo cierra exitoso', async () => {
    const c = client({
      createRefund: vi.fn().mockResolvedValue({ externalRefundId: 'ref_1', status: 'succeeded' }),
    });

    await processOne(db, c, pending);

    expect(repoMocks.markProcessing).toHaveBeenCalled();
    expect(repoMocks.markSucceeded).toHaveBeenCalledTimes(1);
  });

  it('falla el refund si no hay payment intent (sin reclamar la fila)', async () => {
    repoMocks.loadPaymentIntentId.mockResolvedValue(null);

    await processOne(db, client(), pending);

    expect(repoMocks.claimForProcessing).not.toHaveBeenCalled();
    expect(repoMocks.markFailed).toHaveBeenCalledWith(db, pending, 'payment-intent-missing', 1);
  });

  it('libera el claim (releaseClaim) ante error transitorio del POST bajo el limite', async () => {
    const c = client({ createRefund: vi.fn().mockRejectedValue(new Error('503')) });

    await processOne(db, c, { ...pending, attempts: 0 });

    expect(repoMocks.releaseClaim).toHaveBeenCalledWith(db, 'r1', 1);
    expect(repoMocks.markFailed).not.toHaveBeenCalled();
  });

  it('el 3er reintento (espera de 30 min) es alcanzable: con attempts=2 aún libera el claim', async () => {
    const c = client({ createRefund: vi.fn().mockRejectedValue(new Error('boom')) });

    // updated_at viejo: la espera de 5 min venció; el intento 3 falla pero AÚN queda
    // el reintento de 30 min (spec 0028: terminal recién al agotar 1/5/30).
    await processOne(db, c, { ...pending, attempts: 2, updated_at: OLD });

    expect(repoMocks.releaseClaim).toHaveBeenCalledWith(db, 'r1', 3);
    expect(repoMocks.markFailed).not.toHaveBeenCalled();
  });

  it('marca failed cuando se agotan los intentos de creacion (4to intento)', async () => {
    const c = client({ createRefund: vi.fn().mockRejectedValue(new Error('boom')) });

    await processOne(db, c, { ...pending, attempts: 3, updated_at: OLD });

    expect(repoMocks.markFailed).toHaveBeenCalledWith(db, expect.anything(), 'boom', 4);
    expect(repoMocks.releaseClaim).not.toHaveBeenCalled();
  });

  it('respeta el backoff 1/5/30: no re-POSTea antes de la espera mínima (spec 0028)', async () => {
    const c = client();

    // attempts=1 con updated_at fresco: la espera de 1 min no venció -> no crear todavía.
    await processOne(db, c, { ...pending, attempts: 1, updated_at: FRESH });

    expect(repoMocks.claimForProcessing).not.toHaveBeenCalled();
    expect((c as { createRefund: ReturnType<typeof vi.fn> }).createRefund).not.toHaveBeenCalled();
  });

  it('timeout ambiguo del POST: corta a failed(ambiguous-timeout), nunca re-POSTea (spec 0028)', async () => {
    const timeoutErr = new Error('timeout');
    timeoutErr.name = 'TimeoutError';
    const c = client({ createRefund: vi.fn().mockRejectedValue(timeoutErr) });

    await processOne(db, c, pending);

    expect(repoMocks.markFailed).toHaveBeenCalledWith(
      db,
      expect.anything(),
      'ambiguous-timeout',
      1,
    );
    expect(repoMocks.releaseClaim).not.toHaveBeenCalled();
  });

  it('pending CON external_refund_id: verifica por GET, jamás re-POSTea (spec 0028)', async () => {
    const c = client({
      getRefund: vi.fn().mockResolvedValue({ externalRefundId: 'ref_1', status: 'succeeded' }),
    });

    await processOne(db, c, { ...pending, external_refund_id: 'ref_1' });

    expect((c as { createRefund: ReturnType<typeof vi.fn> }).createRefund).not.toHaveBeenCalled();
    expect(repoMocks.claimForProcessing).toHaveBeenCalledWith(db, 'r1', 0);
    expect(repoMocks.markSucceeded).toHaveBeenCalledTimes(1);
  });

  it('si markProcessing falla tras un POST exitoso, NO libera el claim ni asienta (spec 0028)', async () => {
    repoMocks.markProcessing.mockRejectedValue(new Error('db down'));
    const c = client({
      createRefund: vi.fn().mockResolvedValue({ externalRefundId: 'ref_9', status: 'succeeded' }),
    });

    await processOne(db, c, pending);

    // Reintenta la persistencia una vez (2 llamadas) y luego alerta; sin releaseClaim
    // (un release volvería la fila a pending sin id -> re-POST -> doble refund).
    expect(repoMocks.markProcessing).toHaveBeenCalledTimes(2);
    expect(repoMocks.releaseClaim).not.toHaveBeenCalled();
    expect(repoMocks.markSucceeded).not.toHaveBeenCalled();
    expect(repoMocks.markFailed).not.toHaveBeenCalled();
  });

  it('pollea un refund processing y lo cierra succeeded', async () => {
    const c = client({
      getRefund: vi.fn().mockResolvedValue({ externalRefundId: 'ref_1', status: 'succeeded' }),
    });
    const processing = {
      ...pending,
      status: 'processing' as const,
      external_refund_id: 'ref_1',
    };

    await processOne(db, c, processing);

    expect(repoMocks.markSucceeded).toHaveBeenCalledTimes(1);
    expect(repoMocks.markFailed).not.toHaveBeenCalled();
  });

  it('pollea un refund processing y lo cierra failed', async () => {
    const c = client({
      getRefund: vi
        .fn()
        .mockResolvedValue({ externalRefundId: 'ref_1', status: 'failed', failureReason: 'card' }),
    });
    const processing = {
      ...pending,
      status: 'processing' as const,
      external_refund_id: 'ref_1',
    };

    await processOne(db, c, processing);

    expect(repoMocks.markFailed).toHaveBeenCalledWith(db, processing, 'card', 0);
  });

  it('deja un refund processing aun pending (y reciente) sin cambios', async () => {
    const c = client(); // getRefund -> pending
    const processing = {
      ...pending,
      status: 'processing' as const,
      external_refund_id: 'ref_1',
    };

    await processOne(db, c, processing);

    expect(repoMocks.markSucceeded).not.toHaveBeenCalled();
    expect(repoMocks.markFailed).not.toHaveBeenCalled();
  });

  it('corta a failed un refund processing que sigue pending y ya es viejo', async () => {
    const c = client(); // getRefund -> pending
    const stale = {
      ...pending,
      status: 'processing' as const,
      external_refund_id: 'ref_1',
      created_at: OLD,
    };

    await processOne(db, c, stale);

    expect(repoMocks.markFailed).toHaveBeenCalledWith(db, stale, 'processing-timeout', 0);
  });

  it('corta a failed un refund processing sin external_id (claim huérfano) ya viejo', async () => {
    const c = client();
    const orphan = {
      ...pending,
      status: 'processing' as const,
      external_refund_id: null,
      created_at: OLD,
    };

    await processOne(db, c, orphan);

    expect((c as { getRefund: ReturnType<typeof vi.fn> }).getRefund).not.toHaveBeenCalled();
    expect(repoMocks.markFailed).toHaveBeenCalledWith(db, orphan, 'processing-stale', 0);
  });
});
