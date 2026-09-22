import { CENTS_PER_UNIT } from '@shared/constants/bookings';

/** Etiqueta de `Intl` para el locale de la app (es-CR / en-US). */
export function intlLocaleTag(locale: string): string {
  return locale === 'es' ? 'es-CR' : 'en-US';
}

/** Formatea un monto en centavos según moneda y locale (es-CR / en-US). */
export function formatMoneyCents(amountCents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(intlLocaleTag(locale), {
    style: 'currency',
    currency,
  }).format(amountCents / CENTS_PER_UNIT);
}
