import 'server-only';
import { env } from '@/lib/env';
import { createOnvopayAdapter } from './adapters/onvopay';
import type { PaymentProvider } from './types';

// Consume la env TIPADA (spec 0028, B11): la presencia de las llaves se validó al boot
// (instrumentation.ts), no en runtime a mitad de un checkout.
export function getPaymentProvider(): PaymentProvider {
  return createOnvopayAdapter(env.ONVOPAY_SECRET_KEY, env.ONVOPAY_WEBHOOK_SECRET);
}

export type { PaymentProvider, CreatePaymentParams, PaymentSession, WebhookPayload } from './types';
