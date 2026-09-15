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

export type CustomerParams = {
  name: string;
  email: string;
};

/** Datos de una tarjeta guardada, leídos por el servidor (spec 0029 §5.2). */
export type PaymentMethodDetails = {
  id: string;
  status: string | null;
  customerId: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
};

/** Estado de un payment intent según el proveedor. Las decisiones se toman por `status`. */
export type IntentSnapshot = {
  status: string;
  amountCents?: number;
  currency?: string;
  /** URL de autenticación 3DS cuando el intent quedó en requires_action. */
  redirectUrl?: string;
};

/**
 * Estados de un payment intent que distingue la lógica de negocio (spec 0029 §5.6). Hoy coinciden
 * con los de OnvoPay; otra pasarela los traduce en su adapter.
 */
export const PaymentIntentStatus = {
  RequiresPaymentMethod: 'requires_payment_method',
  RequiresAction: 'requires_action',
  Processing: 'processing',
  Succeeded: 'succeeded',
  Canceled: 'canceled',
  Failed: 'failed',
} as const;

export interface PaymentProvider {
  createPaymentSession(params: CreatePaymentParams): Promise<PaymentSession>;
  /**
   * Cancela un payment intent que nunca debe cobrarse (spec 0028: fallo al persistir
   * `payments` en el checkout). Best-effort: el caller tolera el fallo — la garantía
   * real es que el intent no se entrega al widget.
   */
  cancelPaymentSession(externalPaymentId: string): Promise<void>;
  getPaymentIntent(externalPaymentId: string): Promise<IntentSnapshot>;
  /** Cobra un intent con una tarjeta guardada; ver la regla del código HTTP en el adapter. */
  confirmWithPaymentMethod(
    externalPaymentId: string,
    paymentMethodId: string,
    returnUrl: string,
  ): Promise<IntentSnapshot>;
  createCustomer(params: CustomerParams): Promise<{ customerId: string }>;
  getPaymentMethod(paymentMethodId: string): Promise<PaymentMethodDetails>;
  detachPaymentMethod(paymentMethodId: string): Promise<void>;
  deleteCustomer(customerId: string): Promise<void>;
  verifyWebhook(rawBody: string, signature: string): WebhookPayload | null;
}
