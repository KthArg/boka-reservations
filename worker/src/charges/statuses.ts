// Estados que leen y comparan los jobs del cobro diferido (spec 0029). Espejo local de los CHECK de
// la DB: el worker es self-contained y no importa @shared en runtime.

export const BookingState = {
  PendingMinimum: 'pending_minimum',
  PendingPayment: 'pending_payment',
  Confirmed: 'confirmed',
  Cancelled: 'cancelled',
  Refunded: 'refunded',
  OverbookedRefunded: 'overbooked_refunded',
} as const;

export const PaymentRowState = {
  Pending: 'pending',
  Failed: 'failed',
} as const;

export const HoldState = {
  Expired: 'expired',
  Released: 'released',
  Converted: 'converted',
} as const;

/** Filas por ciclo en cada consulta de los jobs del cobro diferido. */
export const BATCH_SIZE = 50;
