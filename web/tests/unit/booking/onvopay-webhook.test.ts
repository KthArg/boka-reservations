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

  // B-1 (spec 0016): nunca lanza ante input inválido; valida el body con Zod.
  it('retorna null (no lanza) con un cuerpo no-JSON', () => {
    expect(() => adapter.verifyWebhook('no es json {', WEBHOOK_SECRET)).not.toThrow();
    expect(adapter.verifyWebhook('no es json {', WEBHOOK_SECRET)).toBeNull();
  });

  it('retorna null si falta un campo requerido (data.amount ausente)', () => {
    const body = JSON.stringify({
      type: 'payment-intent.succeeded',
      data: { id: 'p', status: 'succeeded', currency: 'USD' },
    });
    expect(adapter.verifyWebhook(body, WEBHOOK_SECRET)).toBeNull();
  });

  it('retorna null si amount no es numérico', () => {
    const body = JSON.stringify(makePaymentEvent({ amount: '5000' }));
    expect(adapter.verifyWebhook(body, WEBHOOK_SECRET)).toBeNull();
  });

  it('retorna null con un body que no es objeto', () => {
    expect(adapter.verifyWebhook('"solo-string"', WEBHOOK_SECRET)).toBeNull();
    expect(adapter.verifyWebhook('null', WEBHOOK_SECRET)).toBeNull();
  });
});
