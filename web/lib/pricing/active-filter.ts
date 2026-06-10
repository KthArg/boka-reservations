// Única fuente del filtro de "precio vigente" sobre tour_pricing:
//   active = true  Y  (sin ventana estacional  O  hoy dentro de [valid_from, valid_until]).
// Lo comparten el portal público (getTourPricing) y el checkout (cálculo autoritativo del
// monto, spec 0015), para que el precio se seleccione idéntico en ambos y no pueda derivar.

const ISO_DATE_LENGTH = 10; // longitud de 'YYYY-MM-DD'

/** Hoy en formato YYYY-MM-DD (base de la comparación de la ventana estacional). */
export function pricingToday(): string {
  return new Date().toISOString().slice(0, ISO_DATE_LENGTH);
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
