import { formatMoneyCents, intlLocaleTag } from '@/lib/format/money';
import { CHECKOUT_CURRENCY } from '@shared/constants/bookings';
import {
  PROCESSING_FEE_FIXED_CENTS,
  PROCESSING_FEE_PERCENT_BPS,
  REFUND_FEE_FROM_TERMS_VERSION,
  VAT_RETENTION_PER_100K,
} from '@shared/constants/policies';

const BPS_PER_UNIT = 10_000;
const VAT_PER_UNIT = 100_000;

export type RefundFeeNoticeValues = { percent: string; fixed: string };

/**
 * Valores del aviso de reembolso del checkout, formateados por locale ("4,68%" y "USD 0,25" en ES,
 * "4.68%" y "$0.25" en EN), o `null` con la política inactiva: sin la cláusula en los términos, el
 * aviso no aparece. El porcentaje incluye la retención de IVA, porque es parte del costo que se
 * descuenta. Los montos salen de las constantes, no están escritos en el texto traducido.
 */
export function refundFeeNoticeValues(
  locale: string,
  feeFromTermsVersion: string | null = REFUND_FEE_FROM_TERMS_VERSION,
): RefundFeeNoticeValues | null {
  const fixedCents = PROCESSING_FEE_FIXED_CENTS[CHECKOUT_CURRENCY];
  if (feeFromTermsVersion === null || fixedCents === undefined) return null;
  const percent = new Intl.NumberFormat(intlLocaleTag(locale), {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(PROCESSING_FEE_PERCENT_BPS / BPS_PER_UNIT + VAT_RETENTION_PER_100K / VAT_PER_UNIT);
  return { percent, fixed: formatMoneyCents(fixedCents, CHECKOUT_CURRENCY, locale) };
}
