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
  verifyWebhook(rawBody: string, signature: string): WebhookPayload | null;
}
