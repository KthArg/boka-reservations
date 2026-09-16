// Errores del cambio de tarjeta (spec 0029 §5.2), como claves de `cancellation` en los diccionarios
// (las páginas de la reserva usan ese namespace). Sin server-only: el formulario los importa.

export const CardUpdateError = {
  Unavailable: 'card-unavailable',
  CardInvalid: 'card-invalid',
  CardExpiresBeforeDeparture: 'card-expires-before-departure',
  LimitReached: 'card-update-limit',
  CardInUse: 'card-in-use',
  Generic: 'error-generic',
} as const;

export type CardUpdateErrorValue = (typeof CardUpdateError)[keyof typeof CardUpdateError];
export type CardUpdateResult = { ok: true } | { ok: false; error: CardUpdateErrorValue };

/** Outcomes de update_booking_payment_method distintos de 'updated'. */
export const CARD_UPDATE_OUTCOME_ERRORS: Partial<Record<string, CardUpdateErrorValue>> = {
  not_updatable: CardUpdateError.Unavailable,
  recovery_expired: CardUpdateError.Unavailable,
  customer_mismatch: CardUpdateError.CardInvalid,
  card_data_invalid: CardUpdateError.CardInvalid,
  card_expires_before_departure: CardUpdateError.CardExpiresBeforeDeparture,
  update_limit_reached: CardUpdateError.LimitReached,
};
