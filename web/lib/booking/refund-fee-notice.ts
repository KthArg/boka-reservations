import { formatMoneyCents, intlLocaleTag } from '@/lib/format/money';
import { CHECKOUT_CURRENCY } from '@shared/constants/bookings';
import {
  PROCESSING_FEE_FIXED_CENTS,
  PROCESSING_FEE_PERCENT_BPS,
  REFUND_FEE_FROM_TERMS_VERSION,
} from '@shared/constants/policies';

const BPS_PER_UNIT = 10_000;

export type RefundFeeNoticeValues = { percent: string; fixed: string };

/**
 * Valores del aviso de reembolso del checkout, formateados por locale ("3,9%" y "USD 0,35" en ES,
 * "3.9%" y "$0.35" en EN), o `null` con la política inactiva: sin la cláusula en los términos, el aviso no aparece.
 * Los montos salen de las constantes, no están escritos en el texto traducido.
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
  }).format(PROCESSING_FEE_PERCENT_BPS / BPS_PER_UNIT);
  return { percent, fixed: formatMoneyCents(fixedCents, CHECKOUT_CURRENCY, locale) };
}
