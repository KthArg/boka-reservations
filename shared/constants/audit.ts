import { UserRole } from './enums';

/** Quién originó un evento en `audit_logs` (spec 0011). */
export enum AuditActorType {
  Tourist = 'tourist',
  Staff = 'staff',
  Admin = 'admin',
  System = 'system',
}

/** Acción registrada en `audit_logs`. Cadenas estables `entidad.evento`.
 *  Incluye las que escribe el worker/las RPCs (drift cerrado en spec 0028). */
export enum AuditAction {
  BookingCancelled = 'booking.cancelled',
  BookingConfirmed = 'booking.confirmed',
  BookingOverbookedRefunded = 'booking.overbooked_refunded',
  BookingLatePaymentRefunded = 'booking.late_payment_refunded',
  BookingRecoveredViaReconcile = 'booking.recovered_via_reconcile',
  BookingPaymentMismatch = 'booking.payment_mismatch',
  BookingExpiredPending = 'booking.expired_pending',
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

/** Mapea el rol del usuario interno al actor de auditoría. */
export function actorTypeForRole(role: UserRole): AuditActorType {
  return role === UserRole.Admin ? AuditActorType.Admin : AuditActorType.Staff;
}
