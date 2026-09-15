export enum UserRole {
  Admin = 'admin',
  Staff = 'staff',
  Guide = 'guide',
}

export enum TourStatus {
  Active = 'active',
  Archived = 'archived',
}

export enum TicketType {
  Adult = 'adult',
  Child = 'child',
  Student = 'student',
}

export enum TourDifficulty {
  Easy = 'easy',
  Moderate = 'moderate',
  Hard = 'hard',
}

export enum Currency {
  USD = 'USD',
  CRC = 'CRC',
}

export enum InstanceStatus {
  Available = 'available',
  Full = 'full',
  Cancelled = 'cancelled',
}

/** Resolución terminal de una salida frente al mínimo de participantes de su tour (spec 0029). */
export enum MinimumResolution {
  /** Se alcanzó el mínimo: el cobro se dispara solo. */
  Reached = 'reached',
  /** El staff confirmó la salida bajo el mínimo: se cobra igual. */
  StaffConfirmed = 'staff_confirmed',
  StaffCancelled = 'staff_cancelled',
  /** Tour con cancelación automática: cancelada al llegar la ventana de decisión. */
  AutoCancelled = 'auto_cancelled',
}

export enum BookingStatus {
  PendingPayment = 'pending_payment',
  /** Tarjeta guardada y cupo ocupado, sin cobro: espera el mínimo de la salida (spec 0029). */
  PendingMinimum = 'pending_minimum',
  Confirmed = 'confirmed',
  Cancelled = 'cancelled',
  Refunded = 'refunded',
  /** Pago reportado por OnvoPay no coincide con lo esperado; retenida para
   *  revisión manual (spec 0014). No se confirma ni cuenta como ingreso. */
  PaymentMismatch = 'payment_mismatch',
  /** El pago se concretó pero el cupo ya estaba agotado (spec 0025). Terminal: no
   *  confirma ni incrementa cupo; se reembolsa el total automáticamente. */
  OverbookedRefunded = 'overbooked_refunded',
}

/** Outcome devuelto por la RPC `confirm_booking` (spec 0028). El worker es
 *  self-contained y espeja estos valores en `reconciliation/repository.ts`. */
export enum ConfirmBookingOutcome {
  Confirmed = 'confirmed',
  /** Evento ya procesado o reserva ya resuelta: no-op idempotente. */
  AlreadyProcessed = 'already_processed',
  /** Pago llegó para una reserva `cancelled`: refund total encolado (spec 0028). */
  LatePaymentRefunded = 'late_payment_refunded',
  OverbookedRefunded = 'overbooked_refunded',
  PaymentMismatch = 'payment_mismatch',
  /** Estado no accionable (mismatch previo, pago inexistente): revisión manual. */
  Ignored = 'ignored',
}

/** Estado de un hold de cupo en `tour_holds` (specs 0005, 0025). Antes solo existía
 *  como unión en types/database.ts y el código usaba string literals (spec 0028). */
export enum HoldStatus {
  Active = 'active',
  Released = 'released',
  Expired = 'expired',
  Converted = 'converted',
  /** Payment intent creado: el cupo queda retenido durante el ciclo de pago (spec 0025). */
  Paying = 'paying',
}

export enum PaymentStatus {
  Pending = 'pending',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Refunded = 'refunded',
}

export enum DayOfWeek {
  Sunday = 0,
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6,
}
