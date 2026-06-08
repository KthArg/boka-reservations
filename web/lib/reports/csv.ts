import { CENTS_PER_UNIT } from '@shared/constants/bookings';
import { toCsv } from '@/lib/format/csv';
import {
  reportTourName,
  cancellationRate,
  type RevenueRow,
  type OccupancyRow,
  type RefundsSummary,
} from './types';

const PCT = 100;
const amount = (cents: number) => (cents / CENTS_PER_UNIT).toFixed(2);
const pct = (ratio: number | null) => (ratio === null ? '' : (ratio * PCT).toFixed(1));

export function revenueToCsv(rows: RevenueRow[], locale: string): string {
  const header = ['tour', 'bruto', 'reembolsado', 'neto', 'moneda'];
  return toCsv(
    header,
    rows.map((r) => [
      reportTourName(r, locale),
      amount(r.grossCents),
      amount(r.refundedCents),
      amount(r.netCents),
      r.currency,
    ]),
  );
}

export function occupancyToCsv(rows: OccupancyRow[], locale: string): string {
  const header = [
    'tour',
    'reservas',
    'tiquetes',
    'capacidad',
    'ocupacion_pct',
    'no_shows',
    'reservas_pasadas',
  ];
  return toCsv(
    header,
    rows.map((r) => [
      reportTourName(r, locale),
      String(r.bookingsCount),
      String(r.ticketsSold),
      String(r.capacityTotal),
      pct(r.occupancyPct),
      String(r.noShowCount),
      String(r.pastBookingsCount),
    ]),
  );
}

export function refundsSummaryToCsv(s: RefundsSummary): string {
  const header = [
    'reembolsos_cantidad',
    'reembolsos_monto',
    'canceladas',
    'reservas_validas',
    'tasa_cancelacion_pct',
    'moneda',
  ];
  return toCsv(header, [
    [
      String(s.refundsCount),
      amount(s.refundsAmountCents),
      String(s.cancelledCount),
      String(s.validBookingsCount),
      pct(cancellationRate(s)),
      s.currency,
    ],
  ]);
}
