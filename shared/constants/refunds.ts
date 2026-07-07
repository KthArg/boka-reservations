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
}

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
