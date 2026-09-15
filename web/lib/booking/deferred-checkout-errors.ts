// Errores del checkout diferido (spec 0029 §5.2): códigos internos que lanza el servidor y las
// claves i18n (`checkout.*`) que ve el turista. Sin detalle interno hacia el cliente.

/** Códigos que lanzan lib/booking/deferred-checkout*.ts (además de los RAISE de SQL). */
export const DeferredCheckoutCode = {
  HoldInvalid: 'DEFERRED_HOLD_INVALID',
  CardInvalid: 'DEFERRED_CARD_INVALID',
  CardCustomerMismatch: 'DEFERRED_CARD_CUSTOMER_MISMATCH',
  /** El monto recalculado no es el que el turista autorizó en el mandato. */
  AmountChanged: 'DEFERRED_AMOUNT_CHANGED',
} as const;

/** Claves de `checkout` en los diccionarios. */
export const CheckoutErrorKey = {
  Generic: 'error-generic',
  NoAvailability: 'no-availability',
  InstancePast: 'instance-past',
  HoldExpired: 'hold-expired',
  AmountChanged: 'amount-changed',
  CardInvalid: 'card-invalid',
  CardExpiresBeforeDeparture: 'card-expires-before-departure',
} as const;

export type CheckoutErrorKeyValue = (typeof CheckoutErrorKey)[keyof typeof CheckoutErrorKey];

/** Errores tras los que el checkout solo puede seguir empezando de nuevo desde el paso 1. */
export const RESTART_CHECKOUT_ERRORS: ReadonlySet<CheckoutErrorKeyValue> = new Set([
  CheckoutErrorKey.HoldExpired,
  CheckoutErrorKey.AmountChanged,
]);

// Orden relevante: el primer código contenido en el mensaje gana.
const CODE_TO_KEY: readonly (readonly [string, CheckoutErrorKeyValue])[] = [
  ['HOLD_NO_CAPACITY', CheckoutErrorKey.NoAvailability],
  ['INSTANCE_UNAVAILABLE', CheckoutErrorKey.NoAvailability],
  ['INSTANCE_PAST', CheckoutErrorKey.InstancePast],
  ['HOLD_NOT_ACTIVE', CheckoutErrorKey.HoldExpired],
  ['HOLD_SESSION_MISMATCH', CheckoutErrorKey.HoldExpired],
  ['HOLD_NOT_FOUND', CheckoutErrorKey.HoldExpired],
  ['HOLD_SEATS_MISMATCH', CheckoutErrorKey.HoldExpired],
  [DeferredCheckoutCode.HoldInvalid, CheckoutErrorKey.HoldExpired],
  [DeferredCheckoutCode.AmountChanged, CheckoutErrorKey.AmountChanged],
  ['CARD_EXPIRES_BEFORE_DEPARTURE', CheckoutErrorKey.CardExpiresBeforeDeparture],
  ['CARD_DATA_INVALID', CheckoutErrorKey.CardInvalid],
  ['CARD_DATA_MISSING', CheckoutErrorKey.CardInvalid],
  ['HOLD_CUSTOMER_MISMATCH', CheckoutErrorKey.CardInvalid],
  [DeferredCheckoutCode.CardInvalid, CheckoutErrorKey.CardInvalid],
  [DeferredCheckoutCode.CardCustomerMismatch, CheckoutErrorKey.CardInvalid],
];

/** Traduce un error del checkout a la clave que ve el turista; lo desconocido es genérico. */
export function checkoutErrorKey(err: unknown): CheckoutErrorKeyValue {
  const message = err instanceof Error ? err.message : '';
  return CODE_TO_KEY.find(([code]) => message.includes(code))?.[1] ?? CheckoutErrorKey.Generic;
}
