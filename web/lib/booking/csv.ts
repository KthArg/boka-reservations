import { CENTS_PER_UNIT } from '@shared/constants/bookings';
import { toCsv } from '@/lib/format/csv';
import { formatOperatorDateTime } from './today-range';
import type { AdminExportRow } from './admin-types';

const HEADER = [
  'booking_id',
  'tour',
  'fecha_inicio',
  'hora_inicio',
  'cliente',
  'email',
  'tickets_adult',
  'tickets_child',
  'tickets_student',
  'total_tickets',
  'estado_reserva',
  'estado_pago',
  'monto',
  'moneda',
  'check_in_at',
  'created_at',
];

const amount = (cents: number) => (cents / CENTS_PER_UNIT).toFixed(2);

function toCells(r: AdminExportRow): string[] {
  const { date, time } = formatOperatorDateTime(r.startsAt);
  return [
    r.id,
    r.tourName,
    date,
    time,
    r.customerName,
    r.customerEmail,
    String(r.ticketsAdult),
    String(r.ticketsChild),
    String(r.ticketsStudent),
    String(r.totalTickets),
    r.status,
    r.paymentStatus ?? '',
    amount(r.totalAmountCents),
    r.currency,
    r.checkedInAt ?? '',
    r.createdAt,
  ];
}

/** Serializa las reservas a CSV (UTF-8 con BOM para que Excel respete tildes). */
export function bookingsToCsv(rows: AdminExportRow[]): string {
  return toCsv(HEADER, rows.map(toCells));
}
