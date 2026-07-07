// Tipado mínimo del SDK embebible de OnvoPay (spec 0028, C4): solo la superficie que
// usa CheckoutForm. Reemplaza los 4 `any` con eslint-disable sin justificación.
// Doc: https://docs.onvopay.com/ (widget de pago).

export type OnvoPayConfig = {
  publicKey: string | undefined;
  paymentIntentId: string;
  paymentType: string;
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
