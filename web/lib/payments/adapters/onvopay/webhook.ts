import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { WebhookPayload } from '../../types';

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

export function createWebhookVerifier(webhookSecret: string) {
  return function verifyWebhook(rawBody: string, signature: string): WebhookPayload | null {
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
    // eventId === paymentId === data.id A PROPÓSITO: el webhook de OnvoPay solo trae `type`
    // y `data` a nivel raíz — NO existe un id de evento de envelope distinto de `data.id`
    // (verificado contra https://docs.onvopay.com/en/webhooks, cutover 2026-06-17). `data.id`
    // es el id del payment-intent, único identificador estable del mensaje. Sirve de clave de
    // idempotencia (processed_webhook_events, dentro de confirm_booking) porque el flujo es
    // binario: un único `payment-intent.succeeded` terminal por intent. NO unificar esto si se
    // suma un 2º proveedor que SÍ traiga un event id propio, ni si OnvoPay empezara a emitir
    // más de un evento accionable por intent: ahí el eventId debe ser el id de evento real,
    // no el del recurso (ver pre-production-checklist, Pagos/Webhooks).
    return {
      eventId: body.data.id,
      eventType: body.type,
      paymentId: body.data.id,
      status: body.data.status === 'succeeded' ? 'succeeded' : 'failed',
      amountCents: body.data.amount,
      currency: body.data.currency,
    };
  };
}
