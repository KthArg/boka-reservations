import type { TicketQuantities } from './quantities';

export type PricingRow = {
  ticket_type: 'adult' | 'child' | 'student';
  price_usd: number;
};

const CENTS_PER_UNIT = 100;

/**
 * Suma el total en centavos. Tolerante a precio faltante (lo trata como 0): se usa para el
 * total estimado de UX en CheckoutForm. El cobro real NO usa esta tolerancia — ver
 * `computeAuthoritativeTotal`.
 */
export function calculateTotalCents(quantities: TicketQuantities, pricing: PricingRow[]): number {
  const priceMap = new Map(pricing.map((p) => [p.ticket_type, p.price_usd]));
  const total =
    (quantities.adult * (priceMap.get('adult') ?? 0) +
      quantities.child * (priceMap.get('child') ?? 0) +
      quantities.student * (priceMap.get('student') ?? 0)) *
    CENTS_PER_UNIT;
  return Math.round(total);
}

/**
 * Total autoritativo del cobro (spec 0015). A diferencia de `calculateTotalCents`, exige
 * que cada tipo pedido (cantidad > 0) tenga precio activo: si falta, lanza en vez de cobrar
 * 0 por ese tipo. Exige además total > 0. Los precios SIEMPRE provienen de la DB.
 */
export function computeAuthoritativeTotal(
  quantities: TicketQuantities,
  pricing: PricingRow[],
): number {
  const priceMap = new Map(pricing.map((p) => [p.ticket_type, p.price_usd]));
  if (quantities.adult > 0 && !priceMap.has('adult'))
    throw new Error('CHECKOUT_TICKET_UNAVAILABLE');
  if (quantities.child > 0 && !priceMap.has('child'))
    throw new Error('CHECKOUT_TICKET_UNAVAILABLE');
  if (quantities.student > 0 && !priceMap.has('student'))
    throw new Error('CHECKOUT_TICKET_UNAVAILABLE');

  const total = calculateTotalCents(quantities, pricing);
  if (total <= 0) throw new Error('CHECKOUT_ZERO_AMOUNT');
  return total;
}
