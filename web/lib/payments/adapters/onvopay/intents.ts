import type { CreatePaymentParams, IntentSnapshot, PaymentSession } from '../../types';
import { ensureOk, HTTP_BAD_REQUEST, pathId, readJson, type OnvopayHttp } from './http';

type IntentBody = {
  id: string;
  status: string;
  amount?: number;
  currency?: string;
  nextAction?: { redirectToUrl?: { url?: string } };
};

function toSnapshot(body: IntentBody): IntentSnapshot {
  return {
    status: body.status,
    amountCents: body.amount,
    currency: body.currency,
    redirectUrl: body.nextAction?.redirectToUrl?.url,
  };
}

export function intentOperations(http: OnvopayHttp) {
  async function getPaymentIntent(externalPaymentId: string): Promise<IntentSnapshot> {
    const res = await http('GET', `/payment-intents/${pathId(externalPaymentId)}`);
    return toSnapshot(await readJson<IntentBody>(res, 'getPaymentIntent'));
  }

  return {
    async createPaymentSession(params: CreatePaymentParams): Promise<PaymentSession> {
      const res = await http('POST', '/payment-intents', {
        amount: params.amountCents,
        currency: params.currency,
        description: params.description,
      });
      const data = await readJson<{ id: string }>(res, 'createPaymentSession');
      return { externalPaymentId: data.id };
    },

    async cancelPaymentSession(externalPaymentId: string): Promise<void> {
      // Verificado en sandbox (spec 0029 §5.1): funciona en requires_payment_method y
      // requires_action. Los callers deciden si toleran el fallo.
      const res = await http('POST', `/payment-intents/${pathId(externalPaymentId)}/cancel`);
      ensureOk(res, 'cancelPaymentSession');
    },

    getPaymentIntent,

    /**
     * Confirma con una tarjeta guardada (spec 0029 §5.6). El código HTTP no dice el resultado:
     * un rechazo llega como 201 con status requires_payment_method, y un intent ya cobrado
     * responde 400. Ante un 400 se relee el intent: el caller decide SIEMPRE por status. Un throw
     * (timeout, 5xx) deja el resultado DESCONOCIDO: el caller tiene que leer el intent antes de
     * hacer cualquier otra cosa, nunca volver a confirmar a ciegas.
     */
    async confirmWithPaymentMethod(
      externalPaymentId: string,
      paymentMethodId: string,
      returnUrl: string,
    ): Promise<IntentSnapshot> {
      const res = await http('POST', `/payment-intents/${pathId(externalPaymentId)}/confirm`, {
        paymentMethodId,
        returnUrl,
      });
      if (res.status === HTTP_BAD_REQUEST) {
        // Un 400 también puede ser un request mal armado de nuestro lado: queda registrado.
        console.warn('[onvopay] confirm respondió 400; se decide por el GET del intent');
        return getPaymentIntent(externalPaymentId);
      }
      return toSnapshot(await readJson<IntentBody>(res, 'confirmWithPaymentMethod'));
    },
  };
}
