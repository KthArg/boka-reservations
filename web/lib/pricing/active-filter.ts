// Única fuente del filtro de "precio vigente" sobre tour_pricing:
//   active = true  Y  (sin ventana estacional  O  hoy dentro de [valid_from, valid_until]).
// Lo comparten el portal público (getTourPricing) y el checkout (cálculo autoritativo del
// monto, spec 0015), para que el precio se seleccione idéntico en ambos y no pueda derivar.

import { crDate } from '@/lib/dates/cr-date';

/**
 * Hoy en formato YYYY-MM-DD, en el día calendario de COSTA RICA (spec 0028, B4).
 * Antes usaba la fecha UTC: el cambio de temporada de precios ocurría a las 18:00
 * locales, 6 horas antes de lo que el operador espera.
 */
export function pricingToday(): string {
  return crDate();
}

// El builder de PostgREST no expone un tipo cómodo para encadenar filtros en un helper
// genérico; se usa un tipo laxo, igual que FilterBuilder en lib/booking/repository.ts.
// El resultado se re-tipa en el caller (getTourPricing devuelve PublicPricing[];
// loadActivePricing castea a PricingRow[]).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder de PostgREST
type PricingQuery = any;

export function applyActivePricingFilter(
  query: PricingQuery,
  today: string = pricingToday(),
): PricingQuery {
  return query
    .eq('active', true)
    .or(`valid_from.is.null,and(valid_from.lte.${today},valid_until.gte.${today})`);
}

type WindowedRow = { ticket_type: string; valid_from?: string | null; valid_until?: string | null };

function isSeasonal(row: WindowedRow): boolean {
  return row.valid_from != null || row.valid_until != null;
}

/**
 * Regla de prioridad determinista (spec 0028, B1): cuando conviven un precio BASE
 * (sin fechas) y una TEMPORADA vigente para el mismo ticket_type, la temporada GANA.
 * Devuelve a lo sumo una fila por ticket_type. Antes la selección era un Map sobre un
 * query sin ORDER BY: el monto cobrado dependía del orden físico de las filas.
 * Los constraints de la migración …041 garantizan a lo sumo 1 base + 1 temporada
 * vigentes por (tour, ticket_type), así que esta regla basta para ser determinista.
 */
export function selectEffectivePricing<T extends WindowedRow>(rows: T[]): T[] {
  const byType = new Map<string, T>();
  for (const row of rows) {
    const current = byType.get(row.ticket_type);
    if (!current || wins(row, current)) byType.set(row.ticket_type, row);
  }
  return [...byType.values()];
}

// Tie-break determinista (review pre-PR): si el EXCLUDE de …041 faltara en algún entorno
// y coexistieran dos temporadas vigentes, la selección NO puede depender del orden físico
// de las filas (display y cobro divergirían). Gana la temporada que empezó más tarde
// (más específica); a igual inicio, la que termina antes.
function wins(candidate: WindowedRow, current: WindowedRow): boolean {
  const cSeasonal = isSeasonal(candidate);
  const curSeasonal = isSeasonal(current);
  if (cSeasonal !== curSeasonal) return cSeasonal;
  if (!cSeasonal) return false;
  const fromA = candidate.valid_from ?? '';
  const fromB = current.valid_from ?? '';
  if (fromA !== fromB) return fromA > fromB;
  return (candidate.valid_until ?? '9999-12-31') < (current.valid_until ?? '9999-12-31');
}
