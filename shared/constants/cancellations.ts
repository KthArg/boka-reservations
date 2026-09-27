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
  /** El staff no eligió el motivo al cancelar una reserva cobrada (spec 0032). */
  ReasonRequired = 'cancellation_reason_required',
  /** Solo un admin reembolsa el total de una salida que ya empezó (spec 0032). */
  OperatorRefundAdminOnly = 'cancellation_operator_refund_admin_only',
  /**
   * El estado o el reembolso cambió desde que se mostró la pantalla (spec 0032): p. ej. el cobro
   * diferido se completó o se cruzó el borde de 24 h. No se cancela; la UI recarga.
   */
  StateChanged = 'cancellation_state_changed',
}

/** Motivo de cancel_unpaid_booking que queda auditado (spec 0029 §5.8). */
export const UnpaidCancelReason = {
  CustomerRequest: 'customer_request',
  StaffRequest: 'staff_request',
} as const;

export type UnpaidCancelReasonValue = (typeof UnpaidCancelReason)[keyof typeof UnpaidCancelReason];

/** Resultado de cancel_unpaid_booking (spec 0029 §5.8). */
export const UnpaidCancelOutcome = {
  Cancelled: 'cancelled',
  ChargeInFlight: 'charge_in_flight',
  NotCancellable: 'not_cancellable',
} as const;

/**
 * Resultado de claim_authorization_cancel (spec 0033 §5.6). El claim es la mitad del mecanismo que
 * excluye cancelar y capturar a la vez: ninguna de las dos operaciones puede sostener un lock de
 * fila mientras habla con la pasarela.
 */
export const AuthorizationClaimOutcome = {
  Claimed: 'claimed',
  /** El worker ya está capturando esta reserva: la UI pide reintentar en unos minutos. */
  CaptureInProgress: 'capture_in_progress',
  /** No hay autorización viva: sigue el camino de siempre. */
  NotAuthorized: 'not_authorized',
} as const;

/** Resultado de cancel_authorized_booking (spec 0033 §5.6). */
export const AuthorizedCancelOutcome = {
  Cancelled: 'cancelled',
  NotClaimed: 'not_claimed',
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

/**
 * Motivo de la cancelación de una reserva cobrada (spec 0032). Decide si el reembolso descuenta
 * la comisión de procesamiento: solo cuando cancelar es decisión del cliente. `customer_request`
 * coincide con el de `UnpaidCancelReason`.
 */
export const CancellationReason = {
  CustomerRequest: 'customer_request',
  OperatorDecision: 'operator_decision',
} as const;

export type CancellationReasonValue = (typeof CancellationReason)[keyof typeof CancellationReason];

/** Resultado de la función SQL cancel_booking de 6 parámetros (spec 0032). */
export const CancelBookingOutcome = {
  Cancelled: 'cancelled',
  AlreadyCancelled: 'already_cancelled',
} as const;
