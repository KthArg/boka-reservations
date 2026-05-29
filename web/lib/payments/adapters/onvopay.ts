import type {
  CreatePaymentParams,
  PaymentProvider,
  PaymentSession,
  WebhookPayload,
} from '../types';

const ONVOPAY_API_BASE = 'https://api.onvopay.com/v1';

type OnvopayCreateResponse = {
  id: string;
};

type OnvopayWebhookBody = {
  type: string;
  data: {
    id: string;
    status: string;
    amount: number;
    currency: string;
  };
};

export function createOnvopayAdapter(secretKey: string, webhookSecret: string): PaymentProvider {
  return {
    async createPaymentSession(params: CreatePaymentParams): Promise<PaymentSession> {
      const res = await fetch(`${ONVOPAY_API_BASE}/payment-intents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secretKey}`,
        },
        body: JSON.stringify({
          amount: params.amountCents,
          currency: params.currency,
          description: params.description,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OnvoPay error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as OnvopayCreateResponse;
      return { externalPaymentId: data.id };
    },

    verifyWebhook(rawBody: string, signature: string): WebhookPayload | null {
      // OnvoPay envía el webhook secret directamente en X-Webhook-Secret
      if (signature !== webhookSecret) return null;

      const body = JSON.parse(rawBody) as OnvopayWebhookBody;
      return {
        eventId: body.data.id,
        eventType: body.type,
        paymentId: body.data.id,
        status: body.data.status === 'succeeded' ? 'succeeded' : 'failed',
        amountCents: body.data.amount,
        currency: body.data.currency,
      };
    },
  };
}
