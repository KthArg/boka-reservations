// Operación que prometen los términos (spec 0035): cancelar una salida, mantenerla bajo el mínimo,
// decidir las reservas en revisión, cambiar la fecha de una reserva y devolver por transferencia.
// Los valores espejan los CHECK y los resultados de las funciones de la migración …049.

/** Motivo de cancelación de una salida (`tour_instances.cancellation_reason`). */
export const DepartureCancellationReason = {
  Minimum: 'minimum',
  Weather: 'weather',
  Safety: 'safety',
  /** Fuerza mayor (cierre de ruta, actividad volcánica): se trata como clima o seguridad. */
  ForceMajeure: 'force_majeure',
  Other: 'other',
} as const;

export type DepartureCancellationReasonValue =
  (typeof DepartureCancellationReason)[keyof typeof DepartureCancellationReason];

/** Clima, seguridad o fuerza mayor: sin reembolso automático, cada reserva queda en revisión. */
export const REVIEW_REASONS: readonly DepartureCancellationReasonValue[] = [
  DepartureCancellationReason.Weather,
  DepartureCancellationReason.Safety,
  DepartureCancellationReason.ForceMajeure,
];

/** Aviso mínimo para cancelar por falta de mínimo. */
export const MINIMUM_NOTICE_HOURS = 24;

/** Margen sobre las 24 h: el aviso lo manda el worker al minuto siguiente (…049). */
export const MINIMUM_NOTICE_MARGIN_MINUTES = 10;

/** La bandeja muestra las salidas bajo el mínimo cuyo corte cae en estas horas. */
export const MINIMUM_TRAY_HORIZON_HOURS = 72;

/** El corte del mínimo es el inicio menos 24 h de aviso y 1 h de margen (spec 0035 §5). */
export const MINIMUM_CUTOFF_HOURS = 25;

export const CancelDepartureOutcome = {
  Cancelled: 'cancelled',
  AlreadyCancelled: 'already_cancelled',
  AlreadyStarted: 'already_started',
  AlreadyResolved: 'already_resolved',
  MinimumTooLate: 'minimum_too_late',
  CaptureInProgress: 'capture_in_progress',
} as const;

export const KeepDepartureOutcome = {
  Resolved: 'resolved',
  AlreadyResolved: 'already_resolved',
  AlreadyCancelled: 'already_cancelled',
  DeferredFlow: 'deferred_flow',
} as const;

/** Decisión sobre una reserva en revisión. */
export const ReviewDecision = {
  Refund: 'refund',
  NoRefund: 'no_refund',
} as const;

export type ReviewDecisionValue = (typeof ReviewDecision)[keyof typeof ReviewDecision];

export const ReviewDecisionOutcome = {
  Refunded: 'refunded',
  Closed: 'closed',
  NotUnderReview: 'not_under_review',
} as const;

export const RescheduleOutcome = {
  Rescheduled: 'rescheduled',
  NotConfirmed: 'not_confirmed',
  SameInstance: 'same_instance',
  SourceStarted: 'source_started',
  DifferentTour: 'different_tour',
  TargetUnavailable: 'target_unavailable',
  NoCapacity: 'no_capacity',
} as const;

export const TransferRequestOutcome = {
  Requested: 'requested',
  NotFailed: 'not_failed',
  ProviderMaySettle: 'provider_may_settle',
  OtherRefundActive: 'other_refund_active',
} as const;

export const TransferSettleOutcome = {
  Settled: 'settled',
  NotAwaitingTransfer: 'not_awaiting_transfer',
} as const;

/** Errores de las acciones del panel de este spec. */
export enum OperationError {
  Unauthorized = 'operation_unauthorized',
  Invalid = 'operation_invalid',
  WriteFailed = 'operation_write_failed',
  /** Otra persona (o el proceso del mínimo) resolvió o canceló la salida primero. */
  AlreadyDone = 'operation_already_done',
  AlreadyStarted = 'operation_already_started',
  /** Por mínimo solo se cancela con 24 h o más: con menos, por otra causa. */
  MinimumTooLate = 'operation_minimum_too_late',
  CaptureInProgress = 'operation_capture_in_progress',
  /** La salida tiene reservas del cobro diferido: se decide en su propia bandeja. */
  DeferredFlow = 'operation_deferred_flow',
  NotUnderReview = 'operation_not_under_review',
  NoCapacity = 'operation_no_capacity',
  TargetUnavailable = 'operation_target_unavailable',
  NotReschedulable = 'operation_not_reschedulable',
  /** OnvoPay todavía puede acreditar a la tarjeta: transferir pagaría dos veces. */
  ProviderMaySettle = 'operation_provider_may_settle',
  /** La reserva tiene otro reembolso en curso (un reintento): no se transfiere encima. */
  OtherRefundActive = 'operation_other_refund_active',
}
