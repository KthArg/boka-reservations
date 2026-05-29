import { createOnvopayAdapter } from './adapters/onvopay';
import type { PaymentProvider } from './types';

export function getPaymentProvider(): PaymentProvider {
  const key = process.env.ONVOPAY_SECRET_KEY;
  const secret = process.env.ONVOPAY_WEBHOOK_SECRET;
  if (!key || !secret)
    throw new Error('ONVOPAY_SECRET_KEY y ONVOPAY_WEBHOOK_SECRET son requeridos');
  return createOnvopayAdapter(key, secret);
}

export type { PaymentProvider, CreatePaymentParams, PaymentSession, WebhookPayload } from './types';
