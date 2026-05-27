import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { createOnvopayAdapter } from '@/lib/payments/adapters/onvopay';

const WEBHOOK_SECRET = 'test-secret-key-32-chars-1234567';

function makeSignature(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function makePaymentEvent(overrides: object = {}): object {
  return {
    id: 'evt_abc123',
    type: 'payment.succeeded',
    data: {
      id: 'pay_xyz789',
      status: 'succeeded',
      amount: 5000,
      currency: 'USD',
      metadata: { bookingId: 'booking-uuid-1234' },
      ...overrides,
    },
  };
}

describe('verifyWebhook (OnvoPay)', () => {
  const adapter = createOnvopayAdapter('sk_test_unused', WEBHOOK_SECRET);

  it('retorna payload válido con firma correcta', () => {
    const body = JSON.stringify(makePaymentEvent());
    const sig = makeSignature(body);
    const result = adapter.verifyWebhook(body, sig);

    expect(result).not.toBeNull();
    expect(result?.eventId).toBe('evt_abc123');
    expect(result?.eventType).toBe('payment.succeeded');
    expect(result?.paymentId).toBe('pay_xyz789');
    expect(result?.amountCents).toBe(5000);
    expect(result?.metadata.bookingId).toBe('booking-uuid-1234');
    expect(result?.status).toBe('succeeded');
  });

  it('retorna null con firma incorrecta', () => {
    const body = JSON.stringify(makePaymentEvent());
    const result = adapter.verifyWebhook(body, 'deadbeef');
    expect(result).toBeNull();
  });

  it('retorna null cuando la firma está vacía', () => {
    const body = JSON.stringify(makePaymentEvent());
    const result = adapter.verifyWebhook(body, '');
    expect(result).toBeNull();
  });

  it('retorna null cuando el body fue alterado después de firmar', () => {
    const body = JSON.stringify(makePaymentEvent());
    const sig = makeSignature(body);
    const tampered = body + ' ';
    const result = adapter.verifyWebhook(tampered, sig);
    expect(result).toBeNull();
  });

  it('mapea status failed correctamente', () => {
    const body = JSON.stringify(makePaymentEvent({ status: 'failed' }));
    const sig = makeSignature(body);
    const result = adapter.verifyWebhook(body, sig);
    expect(result?.status).toBe('failed');
  });
});
