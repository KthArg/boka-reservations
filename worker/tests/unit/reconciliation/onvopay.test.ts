import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __testing,
  createOnvopayPaymentIntentClient,
  PaymentIntentOutcome,
} from '../../../src/reconciliation/onvopay.js';

const { mapOutcome } = __testing;

describe('mapOutcome — estado de OnvoPay -> decisión', () => {
  it('succeeded => Paid (recuperar)', () => {
    expect(mapOutcome('succeeded')).toBe(PaymentIntentOutcome.Paid);
  });

  it('canceled y requires_payment_method => NotPaid (cancelar)', () => {
    expect(mapOutcome('canceled')).toBe(PaymentIntentOutcome.NotPaid);
    expect(mapOutcome('requires_payment_method')).toBe(PaymentIntentOutcome.NotPaid);
  });

  it('processing y requires_action => Pending (esperar)', () => {
    expect(mapOutcome('processing')).toBe(PaymentIntentOutcome.Pending);
    expect(mapOutcome('requires_action')).toBe(PaymentIntentOutcome.Pending);
  });

  it('estado desconocido => Pending (nunca cancelar a ciegas)', () => {
    expect(mapOutcome('algo_nuevo_de_onvopay')).toBe(PaymentIntentOutcome.Pending);
  });
});

describe('getPaymentIntent — cliente HTTP', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parsea el estado y lo mapea a outcome', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 'pi_1', status: 'succeeded' }), { status: 200 }),
        ),
    );
    const client = createOnvopayPaymentIntentClient('secret');

    const result = await client.getPaymentIntent('pi_1');

    expect(result).toEqual({ outcome: PaymentIntentOutcome.Paid, rawStatus: 'succeeded' });
  });

  it('lanza si OnvoPay responde no-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
    const client = createOnvopayPaymentIntentClient('secret');

    await expect(client.getPaymentIntent('pi_missing')).rejects.toThrow(
      'onvopay getPaymentIntent 404',
    );
  });
});
