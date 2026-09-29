// Única fuente del filtro de tarifas activas sobre tour_pricing (spec 0040). Ya no filtra por
// fecha: las temporadas se repiten cada año y el precio de una salida lo elige
// `selectPriceForDay` (lib/pricing/season.ts) con el día de la salida. Lo comparten el portal
// público y el checkout (cálculo autoritativo del monto, spec 0015), para que lo que se muestra
// sea lo que se cobra.

/** Columnas que necesita la selección por día. */
export const PRICING_SELECTION_COLUMNS = 'ticket_type, price_usd, season_start, season_end';

// El builder de PostgREST no expone un tipo cómodo para encadenar filtros en un helper
// genérico; se usa un tipo laxo, igual que FilterBuilder en lib/booking/repository.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder de PostgREST
type PricingQuery = any;

export function applyActivePricingFilter(query: PricingQuery): PricingQuery {
  return query.eq('active', true);
}
