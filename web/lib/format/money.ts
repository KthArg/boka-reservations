import { CENTS_PER_UNIT } from '@shared/constants/bookings';

/** Formatea un monto en centavos según moneda y locale (es-CR / en-US). */
export function formatMoneyCents(amountCents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale === 'es' ? 'es-CR' : 'en-US', {
    style: 'currency',
    currency,
  }).format(amountCents / CENTS_PER_UNIT);
}
