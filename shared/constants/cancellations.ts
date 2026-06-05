/** Motivos por los que una cancelación de reserva puede rechazarse (spec 0011). */
export enum CancellationError {
  /** Token de acceso inválido o vencido (flujo del turista). */
  InvalidToken = 'cancellation_invalid_token',
  /** El usuario interno no tiene permiso (flujo del staff). */
  Unauthorized = 'cancellation_unauthorized',
  /** La reserva no existe. */
  NotFound = 'cancellation_not_found',
  /** La reserva no está confirmada (ya cancelada, reembolsada, o sin pagar). */
  NotCancellable = 'cancellation_not_cancellable',
  /** Falló una escritura al cancelar. */
  WriteFailed = 'cancellation_write_failed',
}

/** Motivos por los que el reintento manual de un reembolso puede rechazarse. */
export enum RefundRetryError {
  Unauthorized = 'refund_retry_unauthorized',
  NotFound = 'refund_retry_not_found',
  NotFailed = 'refund_retry_not_failed',
  WriteFailed = 'refund_retry_write_failed',
}
