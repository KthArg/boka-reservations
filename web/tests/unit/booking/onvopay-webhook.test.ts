import { describe, it, expect } from 'vitest';
import { createOnvopayAdapter } from '@/lib/payments/adapters/onvopay';

const WEBHOOK_SECRET = 'whsec_test_abc123';

function makePaymentEvent(overrides: object = {}): object {
  return {
    type: 'payment-intent.succeeded',
    data: {
      id: 'pay_xyz789',
      status: 'succeeded',
      amount: 5000,
      currency: 'USD',
      ...overrides,
    },
  };
}

describe('verifyWebhook (OnvoPay)', () => {
  const adapter = createOnvopayAdapter('sk_test_unused', WEBHOOK_SECRET);

  it('retorna payload válido con secreto correcto', () => {
    const body = JSON.stringify(makePaymentEvent());
    const result = adapter.verifyWebhook(body, WEBHOOK_SECRET);

    expect(result).not.toBeNull();
    expect(result?.eventId).toBe('pay_xyz789');
    expect(result?.eventType).toBe('payment-intent.succeeded');
    expect(result?.paymentId).toBe('pay_xyz789');
    expect(result?.amountCents).toBe(5000);
    expect(result?.status).toBe('succeeded');
  });

  it('retorna null con secreto incorrecto', () => {
    const body = JSON.stringify(makePaymentEvent());
    const result = adapter.verifyWebhook(body, 'wrong-secret');
    expect(result).toBeNull();
  });

  it('retorna null cuando el secreto está vacío', () => {
    const body = JSON.stringify(makePaymentEvent());
    const result = adapter.verifyWebhook(body, '');
    expect(result).toBeNull();
  });

  it('mapea status failed correctamente', () => {
    const body = JSON.stringify(makePaymentEvent({ status: 'failed' }));
    const result = adapter.verifyWebhook(body, WEBHOOK_SECRET);
    expect(result?.status).toBe('failed');
  });

  it('retorna null con secreto parcialmente correcto', () => {
    const body = JSON.stringify(makePaymentEvent());
    const result = adapter.verifyWebhook(body, WEBHOOK_SECRET.slice(0, -1));
    expect(result).toBeNull();
  });
});
