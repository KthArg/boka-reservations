// Tipado mínimo del SDK embebible de OnvoPay (spec 0028, C4): solo la superficie que
// usa CheckoutForm. Reemplaza los 4 `any` con eslint-disable sin justificación.
// Doc: https://docs.onvopay.com/ (widget de pago).

import type { ONVO_PAYMENT_TYPE_ONE_TIME } from '@shared/constants/payments';

export type OnvoPayConfig = {
  publicKey: string | undefined;
  paymentIntentId: string;
  paymentType: typeof ONVO_PAYMENT_TYPE_ONE_TIME;
  onSuccess: () => void;
  onError: () => void;
};

export type OnvoSdk = {
  pay(config: OnvoPayConfig): { render(selector: string): void };
};

declare global {
  interface Window {
    onvo?: OnvoSdk;
  }
}
