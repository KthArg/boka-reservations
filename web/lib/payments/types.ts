export type CreatePaymentParams = {
  amountCents: number;
  currency: string;
  description: string;
  metadata: { bookingId: string };
  successUrl: string;
  cancelUrl: string;
};

export type PaymentSession = {
  paymentUrl: string;
  externalPaymentId: string;
};

export type WebhookPayload = {
  eventId: string;
  eventType: string;
  paymentId: string;
  status: 'succeeded' | 'failed';
  amountCents: number;
  currency: string;
  metadata: { bookingId: string };
};

export interface PaymentProvider {
  createPaymentSession(params: CreatePaymentParams): Promise<PaymentSession>;
  verifyWebhook(rawBody: string, signature: string): WebhookPayload | null;
}
