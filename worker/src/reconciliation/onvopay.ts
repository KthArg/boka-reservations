// Cliente de payment intents de OnvoPay (spec 0013). Vive en el worker porque el
// job de reconciliación es quien consulta a OnvoPay; el worker es self-contained.
// Solo LEE (GET); nunca cobra, cancela ni modifica un pago.
// Vetting 2026-06-07: GET /v1/payment-intents/:id sobre api.onvopay.com/v1.
// Estados (doc oficial): requires_payment_method, requires_action, processing,
// succeeded, canceled.
const ONVOPAY_API_BASE = 'https://api.onvopay.com/v1';
// Timeout defensivo: sin esto una conexión colgada de OnvoPay bloquea el ciclo
// del job y el setInterval del worker apila ciclos solapados.
const HTTP_TIMEOUT_MS = 15_000;

// Qué hacer con la reserva según el estado del payment intent. Se mapea a un
// enum (no se compara contra string literals de estado, por la regla de lint).
export enum PaymentIntentOutcome {
  Paid = 'paid', // succeeded -> confirmar (recuperar webhook perdido)
  NotPaid = 'not_paid', // canceled | requires_payment_method -> cancelar
  Pending = 'pending', // processing | requires_action | desconocido -> esperar
}

export type PaymentIntentResult = {
  outcome: PaymentIntentOutcome;
  // Estado crudo de OnvoPay; viaja como 'reason' al cancelar (es un dato, no una
  // comparación). Útil además para depurar.
  rawStatus: string;
  // Monto/moneda reportados por OnvoPay (campos `amount` en unidad menor = céntimos,
  // y `currency`). Opcionales: si faltan, el reconciliador NO puede validar el monto
  // (spec 0014) y trata el pago como no verificable (saltea, no confirma a ciegas).
  amountCents?: number;
  currency?: string;
};

type OnvopayIntentBody = { id: string; status: string; amount?: number; currency?: string };

// Mapa estado de OnvoPay -> decisión. Lookup en vez de comparaciones con literal
// para no chocar con la regla de lint (mismo patrón que el cliente de refunds).
const STATUS_OUTCOME: Record<string, PaymentIntentOutcome> = {
  succeeded: PaymentIntentOutcome.Paid,
  canceled: PaymentIntentOutcome.NotPaid,
  requires_payment_method: PaymentIntentOutcome.NotPaid,
  processing: PaymentIntentOutcome.Pending,
  requires_action: PaymentIntentOutcome.Pending,
};

function mapOutcome(status: string): PaymentIntentOutcome {
  // Estado desconocido (OnvoPay agrega uno nuevo): se trata como no terminal para
  // nunca cancelar a ciegas. Falla del lado seguro.
  return STATUS_OUTCOME[status] ?? PaymentIntentOutcome.Pending;
}

export function createOnvopayPaymentIntentClient(secretKey: string) {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async getPaymentIntent(externalPaymentId: string): Promise<PaymentIntentResult> {
      const res = await fetch(`${ONVOPAY_API_BASE}/payment-intents/${externalPaymentId}`, {
        headers,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`onvopay getPaymentIntent ${res.status}: ${await res.text()}`);
      }
      const body = (await res.json()) as OnvopayIntentBody;
      return {
        outcome: mapOutcome(body.status),
        rawStatus: body.status,
        amountCents: body.amount,
        currency: body.currency,
      };
    },
  };
}

export type OnvopayPaymentIntentClient = ReturnType<typeof createOnvopayPaymentIntentClient>;

export const __testing = { mapOutcome };
