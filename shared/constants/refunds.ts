/** Estado de un reembolso en la cola `refunds` (spec 0011). Espeja al worker. */
export enum RefundStatus {
  /** Encolado, aún no se llamó a OnvoPay. */
  Pending = 'pending',
  /** POST /v1/refunds hecho; esperando el resultado por polling. */
  Processing = 'processing',
  /** Reembolso acreditado (terminal). */
  Succeeded = 'succeeded',
  /** OnvoPay rechazó o se agotaron los reintentos (retry manual). */
  Failed = 'failed',
  /** La tarjeta no lo aceptó: se devuelve por transferencia o SINPE Móvil (spec 0035). */
  AwaitingTransfer = 'awaiting_transfer',
}

/** Cómo se devolvió el dinero (spec 0035). */
export const RefundMethod = {
  Card: 'card',
  Transfer: 'transfer',
} as const;

/** Canal de una devolución por transferencia (spec 0035). */
export const TransferChannel = {
  SinpeMovil: 'sinpe_movil',
  BankTransfer: 'bank_transfer',
} as const;

export type TransferChannelValue = (typeof TransferChannel)[keyof typeof TransferChannel];

/** Moneda en que se hizo la transferencia: la del cobro, o colones por SINPE Móvil. */
export const TransferCurrency = {
  Usd: 'USD',
  Crc: 'CRC',
} as const;

/** Largo máximo del comprobante de una transferencia. */
export const TRANSFER_REFERENCE_MAX_LENGTH = 100;

/** Motivo enviado a OnvoPay al crear el reembolso. */
export const REFUND_REASON_REQUESTED = 'requested_by_customer';

/**
 * Intentos de `createRefund` (POST a OnvoPay) antes de dar el reembolso por
 * fallido y dejarlo para retry manual. No aplica al polling de un refund ya
 * creado (ese se sigue consultando hasta tener un estado terminal).
 */
export const MAX_REFUND_CREATE_ATTEMPTS = 3;

/**
 * failure_reason con resultado DESCONOCIDO en OnvoPay: el POST pudo haber creado
 * el refund sin que el id quedara persistido (timeout ambiguo, claim huérfano).
 * Si la fila no tiene external_refund_id, el retry manual se bloquea: re-POSTear
 * a ciegas arriesga doble reembolso (spec 0028). El worker espeja estos strings
 * (self-contained) en refunds/handle-refund.ts.
 */
export const REFUND_MANUAL_CHECK_REASONS: readonly string[] = [
  'processing-stale',
  'ambiguous-timeout',
];

/**
 * Motivos con que OnvoPay todavía puede acreditar el reembolso a la tarjeta (spec 0035): los de
 * verificación manual y el timeout de la consulta. Espeja la lista de request_refund_transfer
 * (…049): con uno de estos, devolver por transferencia pagaría dos veces.
 */
export const REFUND_UNSETTLED_REASONS: readonly string[] = [
  ...REFUND_MANUAL_CHECK_REASONS,
  'processing-timeout',
];

/** OnvoPay no encontró el pago: no pudo crear el reembolso, aunque la fila no tenga id externo. */
export const REFUND_PAYMENT_MISSING_REASON = 'payment-intent-missing';
