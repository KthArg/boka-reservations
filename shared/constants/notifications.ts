/** Tipo de notificación encolada en la tabla `notifications` (specs 0007, 0009, 0011). */
export enum NotificationKind {
  BookingConfirmation = 'booking_confirmation',
  Reminder24h = 'reminder_24h',
  GuideAssignment = 'guide_assignment',
  CancellationConfirmation = 'cancellation_confirmation',
  RefundConfirmation = 'refund_confirmation',
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
