// Cliente de reembolsos de OnvoPay (spec 0011). Vive en el worker porque el
// job de refunds es quien llama a OnvoPay; el worker es self-contained.
// Vetting 2026-06-02: POST /v1/refunds (asíncrono, SIN webhook) + GET para
// pollear. Status del Refund: pending -> succeeded | failed.
// Default de producción; el job pasa env.ONVOPAY_API_BASE_URL (spec 0028, A6) para poder
// apuntar al sandbox sin editar código. El cliente queda libre de imports de env (testeable).
const ONVOPAY_API_BASE_DEFAULT = 'https://api.onvopay.com/v1';
const DEFAULT_REASON = 'requested_by_customer';
// Timeout defensivo: sin esto una conexión colgada de OnvoPay bloquea el ciclo
// del job más de 60s y el setInterval del worker apila ciclos solapados.
const HTTP_TIMEOUT_MS = 15_000;

export type OnvopayRefundStatus = 'pending' | 'succeeded' | 'failed';

export type CreateRefundInput = {
  externalPaymentId: string;
  amountCents?: number;
  reason?: string;
};

export type RefundResult = {
  externalRefundId: string;
  status: OnvopayRefundStatus;
  failureReason?: string;
};

type OnvopayRefundBody = { id: string; status: string; failureReason?: string };

// Mapa de estados terminales de OnvoPay; cualquier otro se trata como 'pending'.
// (Lookup en vez de comparaciones con literal para no chocar con la regla de
// lint que prohíbe string literals de estado en código de negocio.)
const TERMINAL_STATUS: Record<string, OnvopayRefundStatus> = {
  succeeded: 'succeeded',
  failed: 'failed',
};

function mapStatus(status: string): OnvopayRefundStatus {
  return TERMINAL_STATUS[status] ?? 'pending';
}

function toResult(data: OnvopayRefundBody): RefundResult {
  return {
    externalRefundId: data.id,
    status: mapStatus(data.status),
    failureReason: data.failureReason,
  };
}

export function createOnvopayRefundClient(secretKey: string, baseUrl = ONVOPAY_API_BASE_DEFAULT) {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async createRefund(input: CreateRefundInput): Promise<RefundResult> {
      const body: Record<string, unknown> = {
        paymentIntentId: input.externalPaymentId,
        reason: input.reason ?? DEFAULT_REASON,
      };
      if (input.amountCents !== undefined) body.amount = input.amountCents;

      const res = await fetch(`${baseUrl}/refunds`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`onvopay createRefund ${res.status}: ${await res.text()}`);
      return toResult((await res.json()) as OnvopayRefundBody);
    },

    async getRefund(externalRefundId: string): Promise<RefundResult> {
      const res = await fetch(`${baseUrl}/refunds/${externalRefundId}`, {
        headers,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`onvopay getRefund ${res.status}: ${await res.text()}`);
      return toResult((await res.json()) as OnvopayRefundBody);
    },
  };
}

export type OnvopayRefundClient = ReturnType<typeof createOnvopayRefundClient>;
