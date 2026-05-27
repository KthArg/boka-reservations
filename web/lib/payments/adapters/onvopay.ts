import { createHmac, timingSafeEqual } from 'crypto';
import type {
  CreatePaymentParams,
  PaymentProvider,
  PaymentSession,
  WebhookPayload,
} from '../types';

const ONVOPAY_API_BASE = 'https://api.onvopay.com/v1';

type OnvopayCreateResponse = {
  id: string;
  payment_url: string;
};

type OnvopayWebhookBody = {
  id: string;
  type: string;
  data: {
    id: string;
    status: string;
    amount: number;
    currency: string;
    metadata: { bookingId: string };
  };
};

export function createOnvopayAdapter(secretKey: string, webhookSecret: string): PaymentProvider {
  return {
    async createPaymentSession(params: CreatePaymentParams): Promise<PaymentSession> {
      const res = await fetch(`${ONVOPAY_API_BASE}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secretKey}`,
        },
        body: JSON.stringify({
          amount: params.amountCents,
          currency: params.currency,
          description: params.description,
          metadata: params.metadata,
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OnvoPay error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as OnvopayCreateResponse;
      return { paymentUrl: data.payment_url, externalPaymentId: data.id };
    },

    verifyWebhook(rawBody: string, signature: string): WebhookPayload | null {
      const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      const actual = Buffer.from(signature, 'hex');
      const expectedBuf = Buffer.from(expected, 'hex');

      if (actual.length !== expectedBuf.length) return null;
      if (!timingSafeEqual(actual, expectedBuf)) return null;

      const body = JSON.parse(rawBody) as OnvopayWebhookBody;
      return {
        eventId: body.id,
        eventType: body.type,
        paymentId: body.data.id,
        status: body.data.status === 'succeeded' ? 'succeeded' : 'failed',
        amountCents: body.data.amount,
        currency: body.data.currency,
        metadata: body.data.metadata,
      };
    },
  };
}
