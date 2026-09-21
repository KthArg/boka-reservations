// Manejo de errores de query del webhook (spec 0028, A3): un fallo transitorio de la
// lectura de `payments` NO es "el pago no existe" — se responde 500 para que OnvoPay
// reintente; el 404 queda solo para el intent realmente desconocido. Mock del cliente
// (patrón del proyecto) porque forzar un error de query contra Postgres real no es
// determinista; el resto del flujo tiene cobertura de integración.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const providerState = vi.hoisted(() => ({
  payload: {
    eventType: 'payment-intent.succeeded',
    eventId: 'evt_1',
    paymentId: 'pi_1',
    amountCents: 5000,
    currency: 'USD',
    status: 'succeeded',
  },
}));

vi.mock('@/lib/payments', () => ({
  getPaymentProvider: () => ({ verifyWebhook: () => providerState.payload }),
}));

const sentryMocks = vi.hoisted(() => ({ captureMessage: vi.fn(), setFingerprint: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  withScope: (cb: (scope: unknown) => void) =>
    cb({ setLevel: vi.fn(), setFingerprint: sentryMocks.setFingerprint, setExtra: vi.fn() }),
  captureMessage: sentryMocks.captureMessage,
}));

const dbState = vi.hoisted(() => ({
  paymentsResult: { data: null, error: null } as { data: unknown; error: unknown },
  rpcResult: { data: 'confirmed', error: null } as { data: unknown; error: unknown },
  rpc: vi.fn(),
}));

vi.mock('@/lib/db/supabase-service', () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => dbState.paymentsResult }),
      }),
    }),
    rpc: async (fn: string, args: unknown) => {
      dbState.rpc(fn, args);
      return dbState.rpcResult;
    },
  }),
}));

import { POST } from '@/app/api/webhooks/onvopay/route';

function request(): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/onvopay', {
    method: 'POST',
    body: JSON.stringify(providerState.payload),
    headers: { 'x-webhook-secret': 'mocked' },
  });
}

describe('webhook — errores de lectura de payments (spec 0028)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.paymentsResult = { data: null, error: null };
    dbState.rpcResult = { data: 'confirmed', error: null };
  });

  it('error de query → 500 (OnvoPay reintenta) sin llamar a confirm_booking', async () => {
    dbState.paymentsResult = { data: null, error: { message: 'connection reset' } };

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(dbState.rpc).not.toHaveBeenCalled();
  });

  it('fila inexistente (sin error) → 404 payment_not_found', async () => {
    dbState.paymentsResult = { data: null, error: null };

    const res = await POST(request());

    expect(res.status).toBe(404);
    expect(dbState.rpc).not.toHaveBeenCalled();
  });

  it('outcome late_payment_refunded → 200 + alerta con fingerprint propio', async () => {
    dbState.paymentsResult = {
      data: { booking_id: 'b1', amount_cents: 5000, currency: 'USD' },
      error: null,
    };
    dbState.rpcResult = { data: 'late_payment_refunded', error: null };

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(dbState.rpc).toHaveBeenCalledWith(
      'confirm_booking',
      expect.objectContaining({ p_booking_id: 'b1', p_event_id: 'evt_1' }),
    );
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith(['webhook-late-payment-refunded']);
  });

  it.each([
    ['duplicate_payment', 'webhook-duplicate-payment'],
    ['late_payment_refund_blocked', 'webhook-late-payment-refund-blocked'],
    ['confirmed_unclaimed', 'webhook-confirmed-unclaimed'],
    ['algo_nuevo', 'webhook-unknown-outcome'],
  ])('outcome %s (spec 0029) → 200 + alerta %s', async (outcome, fingerprint) => {
    dbState.paymentsResult = {
      data: { booking_id: 'b1', amount_cents: 5000, currency: 'USD' },
      error: null,
    };
    dbState.rpcResult = { data: outcome, error: null };

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith([fingerprint]);
  });

  it('outcome confirmed → 200 sin alertas', async () => {
    dbState.paymentsResult = {
      data: { booking_id: 'b1', amount_cents: 5000, currency: 'USD' },
      error: null,
    };
    dbState.rpcResult = { data: 'confirmed', error: null };

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(sentryMocks.captureMessage).not.toHaveBeenCalled();
  });

  it('error de la RPC → 500 para que OnvoPay reintente', async () => {
    dbState.paymentsResult = {
      data: { booking_id: 'b1', amount_cents: 5000, currency: 'USD' },
      error: null,
    };
    dbState.rpcResult = { data: null, error: { message: 'boom' } };

    const res = await POST(request());

    expect(res.status).toBe(500);
  });
});
