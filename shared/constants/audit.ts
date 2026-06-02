/** Quién originó un evento en `audit_logs` (spec 0011). */
export enum AuditActorType {
  Tourist = 'tourist',
  Staff = 'staff',
  Admin = 'admin',
  System = 'system',
}

/** Acción registrada en `audit_logs`. Cadenas estables `entidad.evento`. */
export enum AuditAction {
  BookingCancelled = 'booking.cancelled',
  RefundRequested = 'refund.requested',
  RefundSucceeded = 'refund.succeeded',
  RefundFailed = 'refund.failed',
  RefundRetried = 'refund.retried',
}

/** Tipo de entidad referida por un registro de auditoría. */
export enum AuditEntityType {
  Booking = 'booking',
  Refund = 'refund',
}
