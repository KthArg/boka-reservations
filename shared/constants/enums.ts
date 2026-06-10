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

export enum BookingStatus {
  PendingPayment = 'pending_payment',
  Confirmed = 'confirmed',
  Cancelled = 'cancelled',
  Refunded = 'refunded',
  /** Pago reportado por OnvoPay no coincide con lo esperado; retenida para
   *  revisión manual (spec 0014). No se confirma ni cuenta como ingreso. */
  PaymentMismatch = 'payment_mismatch',
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
