export type CreatePaymentParams = {
  amountCents: number;
  currency: string;
  description: string;
};

export type PaymentSession = {
  externalPaymentId: string;
};

export type WebhookPayload = {
  eventId: string;
  eventType: string;
  paymentId: string;
  status: 'succeeded' | 'failed';
  amountCents: number;
  currency: string;
};

export interface PaymentProvider {
  createPaymentSession(params: CreatePaymentParams): Promise<PaymentSession>;
  /**
   * Cancela un payment intent que nunca debe cobrarse (spec 0028: fallo al persistir
   * `payments` en el checkout). Best-effort: el caller tolera el fallo — la garantía
   * real es que el intent no se entrega al widget.
   */
  cancelPaymentSession(externalPaymentId: string): Promise<void>;
  verifyWebhook(rawBody: string, signature: string): WebhookPayload | null;
}
