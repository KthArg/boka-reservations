/** Tipo de notificación encolada en la tabla `notifications` (specs 0007, 0009, 0011, 0025, 0029). */
export enum NotificationKind {
  BookingConfirmation = 'booking_confirmation',
  Reminder24h = 'reminder_24h',
  GuideAssignment = 'guide_assignment',
  CancellationConfirmation = 'cancellation_confirmation',
  RefundConfirmation = 'refund_confirmation',
  /** Cupo agotado al confirmar: reserva auto-reembolsada (spec 0025). Faltaba acá
   *  aunque el CHECK de DB y el worker ya lo tenían (drift cerrado en spec 0028). */
  OverbookedRefunded = 'overbooked_refunded',
  /** Reserva con tarjeta guardada, todavía sin cargo (spec 0029). */
  BookingReserved = 'booking_reserved',
  /** Salida cancelada por no alcanzar el mínimo de participantes (spec 0029). */
  DepartureCancelledMinimum = 'departure_cancelled_minimum',
  /** Avisos de tarjeta rechazada: tres kinds porque (booking_id, kind) es único (spec 0029 §5.7). */
  ChargeFailedActionRequired1 = 'charge_failed_action_required_1',
  ChargeFailedActionRequired2 = 'charge_failed_action_required_2',
  ChargeFailedActionRequired3 = 'charge_failed_action_required_3',
  /** El banco pidió autenticación 3DS: el turista debe completarla (spec 0029). */
  ChargeRequiresAction = 'charge_requires_action',
  /** El operador canceló la salida: motivo y reembolso, o reserva en revisión (spec 0035). */
  DepartureCancelled = 'departure_cancelled',
  /** La reserva pasó a otra salida del mismo tour (spec 0035). */
  BookingRescheduled = 'booking_rescheduled',
  /** La tarjeta no aceptó el reembolso: se piden los datos de una cuenta (spec 0035). */
  RefundTransferRequest = 'refund_transfer_request',
}

/** Canal de entrega. Hoy solo email; el enum deja lugar a SMS/WhatsApp futuros. */
export enum NotificationChannel {
  Email = 'email',
}

/** Estado de una notificación en la cola. */
export enum NotificationStatus {
  Pending = 'pending',
  Sent = 'sent',
  Failed = 'failed',
  Cancelled = 'cancelled',
}
