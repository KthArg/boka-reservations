import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
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

// Esquema del cuerpo del webhook (spec 0016, B-1). Se valida ANTES de mapearlo para que
// un body malformado o con campos faltantes no se propague como `undefined` a la
// validación de monto del 0014 (que marcaría falso payment_mismatch o lanzaría).
const OnvopayWebhookBodySchema = z.object({
  type: z.string(),
  data: z.object({
    id: z.string(),
    status: z.string(),
    amount: z.number(),
    currency: z.string(),
  }),
});

/** Compara el secreto en tiempo constante (evita fuga de timing del header secret). */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
      // OnvoPay envía el webhook secret directamente en X-Webhook-Secret (secreto
      // estático, no HMAC por mensaje — es su diseño). Comparación constant-time.
      if (!secretMatches(signature, webhookSecret)) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const result = OnvopayWebhookBodySchema.safeParse(parsed);
      if (!result.success) return null;

      const body = result.data;
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
