import { CENTS_PER_UNIT } from '@shared/constants/bookings';

/** Etiqueta de `Intl` para el locale de la app (es-CR / en-US). */
export function intlLocaleTag(locale: string): string {
  return locale === 'es' ? 'es-CR' : 'en-US';
}

/**
 * El número de un monto en centavos, con dos decimales y el separador del idioma ("6,90" en
 * español, "6.90" en inglés). Para textos que ya escriben la moneda ("USD {amount}").
 */
export function formatAmountCents(amountCents: number, locale: string): string {
  return new Intl.NumberFormat(intlLocaleTag(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / CENTS_PER_UNIT);
}

/** Formatea un monto en centavos según moneda y locale (es-CR / en-US). */
export function formatMoneyCents(amountCents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(intlLocaleTag(locale), {
    style: 'currency',
    currency,
  }).format(amountCents / CENTS_PER_UNIT);
}
