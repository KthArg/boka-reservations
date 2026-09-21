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
  /** Reserva sin cobrar con el cobro en curso (spec 0029): reintentar en unos minutos. */
  ChargeInFlight = 'cancellation_charge_in_flight',
}

/** Motivo de cancel_unpaid_booking que queda auditado (spec 0029 §5.8). */
export const UnpaidCancelReason = {
  CustomerRequest: 'customer_request',
  StaffRequest: 'staff_request',
} as const;

/** Resultado de cancel_unpaid_booking (spec 0029 §5.8). */
export const UnpaidCancelOutcome = {
  Cancelled: 'cancelled',
  ChargeInFlight: 'charge_in_flight',
  NotCancellable: 'not_cancellable',
} as const;

/** Motivos por los que el reintento manual de un reembolso puede rechazarse. */
export enum RefundRetryError {
  Unauthorized = 'refund_retry_unauthorized',
  NotFound = 'refund_retry_not_found',
  NotFailed = 'refund_retry_not_failed',
  WriteFailed = 'refund_retry_write_failed',
  /** El resultado del POST anterior es DESCONOCIDO (timeout ambiguo / claim huérfano
   *  sin id persistido): re-crear a ciegas arriesga doble reembolso. Verificar en el
   *  dashboard de OnvoPay (el id, si existe, está en la alerta de Sentry) antes de
   *  reintentar (spec 0028). */
  RequiresManualCheck = 'refund_retry_requires_manual_check',
}
