/**
 * Políticas de negocio parametrizables. Aislar la regla acá permite cambiarla
 * sin tocar la lógica que la consume (specs 0011 y 0032).
 */
import { CancellationReason, type CancellationReasonValue } from './cancellations';
import { Currency } from './enums';

/** Antelación mínima sobre el inicio del tour para tener derecho a reembolso. */
export const CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Costo de OnvoPay por cobro con tarjeta (spec 0032). Verificado el 2026-09-23 contra la
 * `balanceTransaction` de un cobro en sandbox y contra la tabla de la cuenta, que el soporte
 * detalló ese día (`docs/onvopay-consulta-reembolsos.md`). Sobre un cobro de US$60:
 *   - comisión (`fee`) US$2,59 = 3,9 % (servicios ONVO 1,65 + adquirencia ONVO 0,3 + adquirencia
 *     procesador 0,2 + emisión 1,75) + US$0,25 fijos (transacción adquirente 0,12 + ONVO 0,13);
 *   - retención de IVA (`vatTax`) US$0,47 = 0,777 % del MONTO de la transacción. El soporte dijo
 *     que era sobre la comisión; la `balanceTransaction` demuestra que no.
 * La página de precios dice US$0,35 de fijo; la cuenta cobra US$0,25.
 * Decisión del usuario (2026-09-23): se descuenta el costo total, retención incluida.
 * Si se suma otro proveedor de pagos, esto pasa a un mapa por proveedor y moneda.
 */
export const PROCESSING_FEE_PERCENT_BPS = 390;
export const PROCESSING_FEE_FIXED_CENTS: Partial<Record<Currency, number>> = {
  [Currency.USD]: 25,
};

/** Retención de IVA sobre el monto de la transacción: 0,777 % = 777 por cada 100 000. */
export const VAT_RETENTION_PER_100K = 777;

/**
 * Primera versión de términos (`TERMS_VERSION`, formato `YYYY-MM-DD`) que contiene la cláusula
 * de reembolso menos comisión. En `null`, la política está inactiva y toda cancelación del
 * cliente con antelación recibe el reembolso total. Se activa en el mismo deploy que publica esos
 * términos (spec 0032 §11).
 */
export const REFUND_FEE_FROM_TERMS_VERSION: string | null = null;

const BPS_DIVISOR = 10_000;
const HALF_BPS_DIVISOR = 5_000;
const VAT_DIVISOR = 100_000;
const HALF_VAT_DIVISOR = 50_000;

export type RefundEligibility = {
  eligible: boolean;
  amountCents: number;
  /** Comisión de procesamiento descontada del reembolso (0 si no se descontó). */
  feeCents: number;
};

/** Sin reembolso: fuera de la ventana, reserva sin cobrar o no confirmada. */
export const NO_REFUND: RefundEligibility = { eligible: false, amountCents: 0, feeCents: 0 };

export class ProcessingFeeNotConfiguredError extends Error {
  constructor(currency: string) {
    super(`Sin comisión de procesamiento configurada para ${currency}`);
    this.name = 'ProcessingFeeNotConfiguredError';
  }
}

/**
 * Costo de procesamiento de un cobro, en centavos: comisión más retención de IVA. Solo aritmética
 * entera, con cada componente redondeado al centavo más cercano (mitad hacia arriba), igual que
 * los calcula OnvoPay en su `balanceTransaction`.
 */
export function computeProcessingFee(totalCents: number, currency: string): number {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new RangeError(`Monto inválido para calcular la comisión: ${totalCents}`);
  }
  const fixed = PROCESSING_FEE_FIXED_CENTS[currency as Currency];
  if (fixed === undefined) throw new ProcessingFeeNotConfiguredError(currency);
  const percent = Math.floor(
    (totalCents * PROCESSING_FEE_PERCENT_BPS + HALF_BPS_DIVISOR) / BPS_DIVISOR,
  );
  const vatRetention = Math.floor(
    (totalCents * VAT_RETENTION_PER_100K + HALF_VAT_DIVISOR) / VAT_DIVISOR,
  );
  return percent + fixed + vatRetention;
}

type ComputeRefundInput = {
  startsAt: Date;
  totalAmountCents: number;
  currency: string;
  /** `bookings.terms_version`: la versión de términos que aceptó el turista (spec 0031). */
  termsVersion: string | null;
  reason: CancellationReasonValue;
  now: Date;
  /** Versión de corte; los tests la inyectan. Por defecto, la configurada. */
  feeFromTermsVersion?: string | null;
};

/**
 * Decide si una cancelación de una reserva cobrada tiene derecho a reembolso y por cuánto.
 *
 * - Por decisión del operador: siempre el total.
 * - A pedido del cliente con menos de `CANCELLATION_WINDOW_MS` de antelación: nada (el borde
 *   exacto cuenta como elegible).
 * - A pedido del cliente con antelación: el total menos la comisión de procesamiento, solo si
 *   aceptó términos que incluyen la cláusula; si no, el total.
 *
 * La comparación de versiones es de strings: funciona porque son fechas `YYYY-MM-DD`.
 */
export function computeRefund({
  startsAt,
  totalAmountCents,
  currency,
  termsVersion,
  reason,
  now,
  feeFromTermsVersion = REFUND_FEE_FROM_TERMS_VERSION,
}: ComputeRefundInput): RefundEligibility {
  if (reason === CancellationReason.OperatorDecision) {
    return { eligible: totalAmountCents > 0, amountCents: totalAmountCents, feeCents: 0 };
  }

  const leadMs = startsAt.getTime() - now.getTime();
  if (leadMs < CANCELLATION_WINDOW_MS) return NO_REFUND;

  const clauseAccepted =
    feeFromTermsVersion !== null && termsVersion !== null && termsVersion >= feeFromTermsVersion;
  if (!clauseAccepted) {
    return { eligible: totalAmountCents > 0, amountCents: totalAmountCents, feeCents: 0 };
  }

  const feeCents = Math.min(computeProcessingFee(totalAmountCents, currency), totalAmountCents);
  const amountCents = totalAmountCents - feeCents;
  return { eligible: amountCents > 0, amountCents, feeCents };
}
