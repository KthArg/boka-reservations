// Cliente de cobros de OnvoPay para los jobs del cobro diferido (specs 0029 y 0033). El worker es
// self-contained: no comparte el adapter de web.
// Verificado en sandbox (2026-09-14): cancel funciona en requires_action y requires_payment_method;
// detach deja el método `detached` y DELETE del customer devuelve 200.
// Verificado en sandbox (2026-09-23): con captureMethod 'manual', confirmar deja la intención en
// requires_capture; capture la cobra; cancel la suelta sin dejar transacción de balance.
const ONVOPAY_API_BASE_DEFAULT = 'https://api.onvopay.com/v1';
// Timeout defensivo, igual que refunds y reconciliación: una conexión colgada no apila ciclos.
const HTTP_TIMEOUT_MS = 15_000;
const NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;

export type IntentSnapshot = {
  /** Estado crudo de OnvoPay; la decisión la toma charges/decide.ts. */
  status: string;
  amountCents?: number;
  currency?: string;
};

type IntentBody = { id: string; status: string; amount?: number; currency?: string };
type PaymentMethodBody = { id: string; status?: string };

const DETACHED_STATUS = 'detached';

export function createOnvopayChargeClient(secretKey: string, baseUrl = ONVOPAY_API_BASE_DEFAULT) {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  }

  async function fail(operation: string, res: Response): Promise<never> {
    throw new Error(`onvopay ${operation} ${res.status}: ${await res.text()}`);
  }

  return {
    /**
     * `null` si el intent no existe para esta llave (404): no puede cobrar en esta cuenta. Sin
     * distinguirlo, un intent de otro entorno lanzaría en cada ciclo y la reserva no avanzaría.
     */
    async getIntent(externalPaymentId: string): Promise<IntentSnapshot | null> {
      const res = await request('GET', `/payment-intents/${externalPaymentId}`);
      if (res.status === NOT_FOUND) return null;
      if (!res.ok) return fail('getIntent', res);
      const body = (await res.json()) as IntentBody;
      return { status: body.status, amountCents: body.amount, currency: body.currency };
    },

    /**
     * Intent con captura manual (spec 0033): confirmarlo reserva la plata sin cobrarla. Si no se
     * captura en 30 días, OnvoPay la libera sola.
     */
    async createManualCaptureIntent(input: {
      amountCents: number;
      currency: string;
      description: string;
    }): Promise<string> {
      const res = await request('POST', '/payment-intents', {
        amount: input.amountCents,
        currency: input.currency,
        description: input.description,
        captureMethod: 'manual',
      });
      if (!res.ok) return fail('createManualCaptureIntent', res);
      const body = (await res.json()) as IntentBody;
      return body.id;
    },

    /**
     * Un 400 NO es un rechazo de la tarjeta: puede ser un intent ya confirmado. Se relee con GET
     * antes de decidir, igual que hace el adapter de la web.
     */
    async confirmIntent(
      externalPaymentId: string,
      input: { paymentMethodId: string; returnUrl: string },
    ): Promise<IntentSnapshot> {
      const res = await request('POST', `/payment-intents/${externalPaymentId}/confirm`, {
        paymentMethodId: input.paymentMethodId,
        returnUrl: input.returnUrl,
      });
      if (res.status === HTTP_BAD_REQUEST) {
        const snapshot = await this.getIntent(externalPaymentId);
        if (snapshot) return snapshot;
      }
      if (!res.ok) return fail('confirmIntent', res);
      const body = (await res.json()) as IntentBody;
      return { status: body.status, amountCents: body.amount, currency: body.currency };
    },

    /** Cobra una autorización. El único momento en que se mueve plata (spec 0033). */
    async captureIntent(externalPaymentId: string): Promise<IntentSnapshot> {
      const res = await request('POST', `/payment-intents/${externalPaymentId}/capture`);
      if (!res.ok) return fail('captureIntent', res);
      const body = (await res.json()) as IntentBody;
      return { status: body.status, amountCents: body.amount, currency: body.currency };
    },

    async cancelIntent(externalPaymentId: string): Promise<void> {
      const res = await request('POST', `/payment-intents/${externalPaymentId}/cancel`);
      if (!res.ok) await fail('cancelIntent', res);
    },

    /** Métodos todavía vinculados; un customer que ya no existe no tiene ninguno. */
    async listAttachedPaymentMethods(customerId: string): Promise<string[]> {
      const res = await request('GET', `/customers/${customerId}/payment-methods`);
      if (res.status === NOT_FOUND) return [];
      if (!res.ok) return fail('listPaymentMethods', res);
      const body = (await res.json()) as PaymentMethodBody[];
      return body.filter((method) => method.status !== DETACHED_STATUS).map((method) => method.id);
    },

    async detachPaymentMethod(paymentMethodId: string): Promise<void> {
      const res = await request('POST', `/payment-methods/${paymentMethodId}/detach`);
      if (!res.ok) await fail('detach', res);
    },

    /** Idempotente: un customer ya borrado (404) cuenta como borrado. */
    async deleteCustomer(customerId: string): Promise<void> {
      const res = await request('DELETE', `/customers/${customerId}`);
      if (res.status === NOT_FOUND) return;
      if (!res.ok) await fail('deleteCustomer', res);
    },
  };
}

export type OnvopayChargeClient = ReturnType<typeof createOnvopayChargeClient>;
