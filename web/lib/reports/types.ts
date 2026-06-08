// Tipos de los reportes y helper de nombre. Módulo puro (sin server-only) para
// poder unit-testear la serialización CSV sin arrastrar el guard de servidor.

export type RevenueRow = {
  tourId: string;
  nameEs: string;
  nameEn: string;
  grossCents: number;
  refundedCents: number;
  netCents: number;
  currency: string;
};

export type OccupancyRow = {
  tourId: string;
  nameEs: string;
  nameEn: string;
  bookingsCount: number;
  ticketsSold: number;
  capacityTotal: number;
  /** Fracción 0..1, o null si no hay capacidad. */
  occupancyPct: number | null;
  noShowCount: number;
  pastBookingsCount: number;
};

export type RefundsSummary = {
  refundsCount: number;
  refundsAmountCents: number;
  cancelledCount: number;
  validBookingsCount: number;
  currency: string;
};

/** Nombre del tour según el locale. */
export function reportTourName(row: { nameEs: string; nameEn: string }, locale: string): string {
  return locale === 'es' ? row.nameEs : row.nameEn;
}

/** Tasa de cancelación 0..1, o null si no hay reservas válidas. */
export function cancellationRate(s: RefundsSummary): number | null {
  return s.validBookingsCount === 0 ? null : s.cancelledCount / s.validBookingsCount;
}

/** Tasa de no-show 0..1 de un tour, o null si no hay reservas pasadas. */
export function noShowRate(r: OccupancyRow): number | null {
  return r.pastBookingsCount === 0 ? null : r.noShowCount / r.pastBookingsCount;
}

const PERCENT_MULTIPLIER = 100;

/** Formatea una fracción 0..1 como porcentaje ('—' si es null). */
export function formatRatioPct(ratio: number | null): string {
  return ratio === null ? '—' : `${(ratio * PERCENT_MULTIPLIER).toFixed(1)}%`;
}
