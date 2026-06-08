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
  status: string;
  checkedInAt: string | null;
  createdAt: string;
  updatedAt: string;
  paymentStatus: string | null;
  paymentProvider: string | null;
  notifications: AdminBookingNotification[];
  refund: AdminBookingRefund | null;
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
