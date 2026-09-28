import type { BookingStatus } from '@shared/constants/enums';

/** Filtros del listado de reservas del panel (derivados de query params). */
export interface BookingFilters {
  dateFrom?: string; // YYYY-MM-DD sobre tour_instances.starts_at
  dateTo?: string;
  tourId?: string;
  status?: BookingStatus;
  search?: string; // matchea customer_name / customer_email
  page: number; // 1-based
}

/** Una fila de la tabla de reservas. */
export interface AdminBookingRow {
  id: string;
  startsAt: string;
  tourName: string;
  customerName: string;
  totalTickets: number;
  status: string;
  paymentStatus: string | null;
  checkedInAt: string | null;
}

/** Notificación asociada a una reserva, en el detalle. */
export interface AdminBookingNotification {
  kind: string;
  status: string;
  sentAt: string | null;
}

/** Reembolso asociado a una reserva, en el detalle. */
export interface AdminBookingRefund {
  id: string;
  status: string;
  failureReason: string | null;
  amountCents: number;
  currency: string;
  /** `card` o `transfer` (spec 0035). */
  method: string;
  transferChannel: string | null;
  /** Lo que se transfirió de verdad (en colones por SINPE Móvil, por ejemplo). */
  transferAmountCents: number | null;
  transferCurrency: string | null;
  /**
   * Se puede devolver por transferencia: OnvoPay tiene el reembolso y lo rechazó de forma
   * definitiva. En los otros casos todavía puede acreditarse a la tarjeta (spec 0035).
   */
  transferAllowed: boolean;
}

/** Detalle completo de una reserva. */
export interface AdminBookingDetail {
  id: string;
  customerName: string;
  customerEmail: string;
  tourName: string;
  startsAt: string;
  endsAt: string;
  ticketsAdult: number;
  ticketsChild: number;
  ticketsStudent: number;
  totalAmountCents: number;
  currency: string;
  /** Versión de términos que aceptó el turista. */
  termsVersion: string | null;
  status: string;
  checkedInAt: string | null;
  createdAt: string;
  updatedAt: string;
  paymentStatus: string | null;
  paymentProvider: string | null;
  /** Cobro diferido (spec 0029): intentos de cobro y tarjeta guardada, si hay. */
  chargeAttempts: number;
  cardLast4: string | null;
  hasSavedCard: boolean;
  notifications: AdminBookingNotification[];
  refund: AdminBookingRefund | null;
  /** Salida y tour: el cambio de fecha ofrece otras salidas del mismo tour (spec 0035). */
  tourId: string;
  instanceId: string;
  /** Motivo de cancelación de la salida, si se canceló. */
  cancellationReason: string | null;
  /** Salida cancelada por clima o seguridad: la reserva espera la decisión del equipo. */
  underReview: boolean;
}

/** Fila enriquecida para el export CSV (más columnas que la lista). */
export interface AdminExportRow {
  id: string;
  tourName: string;
  startsAt: string;
  customerName: string;
  customerEmail: string;
  ticketsAdult: number;
  ticketsChild: number;
  ticketsStudent: number;
  totalTickets: number;
  status: string;
  paymentStatus: string | null;
  totalAmountCents: number;
  currency: string;
  checkedInAt: string | null;
  createdAt: string;
}

/** Instancia de tour del día, con agregados de ocupación. */
export interface TodayInstance {
  id: string;
  tourId: string;
  tourName: string;
  startsAt: string;
  capacityTotal: number;
  confirmedTickets: number;
  checkedInCount: number;
}

/** Resultado paginado del listado. */
export interface AdminBookingPage {
  rows: AdminBookingRow[];
  total: number;
}
