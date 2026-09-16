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
  /** Reserva diferida registrada con tarjeta guardada, sin cobro (spec 0029). */
  BookingReserved = 'booking.reserved',
  /** Cobro en vuelo cancelado al vencer su plazo (spec 0029). */
  BookingChargeCancelled = 'booking.charge_cancelled',
  BookingPaymentMethodUpdated = 'booking.payment_method_updated',
  ChargeStarted = 'charge.started',
  ChargeFailed = 'charge.failed',
  ChargeRequiresAction = 'charge.requires_action',
  /** Fila pending liberada tras comprobar que su intent se cerró (spec 0029 §5.6). */
  ChargeIntentClosed = 'charge.intent_closed',
  /** Segundo intent cobrado sobre una reserva ya resuelta: doble cobro (spec 0029 §5.6). */
  BookingDuplicatePayment = 'booking.duplicate_payment',
  /** Pago tardío cuyo refund no se pudo encolar (ya había uno activo): reembolso manual. */
  BookingLatePaymentRefundBlocked = 'booking.late_payment_refund_blocked',
  /** Cierre del intent registrado a mano tras verificarlo en OnvoPay (spec 0029 §5.9). */
  PaymentProviderClosedManually = 'payment.provider_closed_manually',
  /** Customer de OnvoPay borrado por la limpieza de close-payment-intents (spec 0029 §5.9). */
  CustomerProviderDeleted = 'customer.provider_deleted',
  RefundRequested = 'refund.requested',
  RefundSucceeded = 'refund.succeeded',
  RefundFailed = 'refund.failed',
  RefundRetried = 'refund.retried',
}

/** Tipo de entidad referida por un registro de auditoría. */
export enum AuditEntityType {
  Booking = 'booking',
  Refund = 'refund',
  TourHold = 'tour_hold',
}

/** Mapea el rol del usuario interno al actor de auditoría. */
export function actorTypeForRole(role: UserRole): AuditActorType {
  return role === UserRole.Admin ? AuditActorType.Admin : AuditActorType.Staff;
}
