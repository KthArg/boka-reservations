// Cliente de reembolsos de OnvoPay (spec 0011). Vive en el worker porque el
// job de refunds es quien llama a OnvoPay; el worker es self-contained.
// Vetting 2026-06-02: POST /v1/refunds (asíncrono, SIN webhook) + GET para
// pollear. Status del Refund: pending -> succeeded | failed.
const ONVOPAY_API_BASE = 'https://api.onvopay.com/v1';
const DEFAULT_REASON = 'requested_by_customer';

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

function mapStatus(status: string): OnvopayRefundStatus {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function toResult(data: OnvopayRefundBody): RefundResult {
  return {
    externalRefundId: data.id,
    status: mapStatus(data.status),
    failureReason: data.failureReason,
  };
}

export function createOnvopayRefundClient(secretKey: string) {
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

      const res = await fetch(`${ONVOPAY_API_BASE}/refunds`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`onvopay createRefund ${res.status}: ${await res.text()}`);
      return toResult((await res.json()) as OnvopayRefundBody);
    },

    async getRefund(externalRefundId: string): Promise<RefundResult> {
      const res = await fetch(`${ONVOPAY_API_BASE}/refunds/${externalRefundId}`, { headers });
      if (!res.ok) throw new Error(`onvopay getRefund ${res.status}: ${await res.text()}`);
      return toResult((await res.json()) as OnvopayRefundBody);
    },
  };
}

export type OnvopayRefundClient = ReturnType<typeof createOnvopayRefundClient>;
