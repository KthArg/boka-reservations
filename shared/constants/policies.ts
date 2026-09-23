/**
 * Políticas de negocio parametrizables. Aislar la regla acá permite cambiarla
 * sin tocar la lógica que la consume (specs 0011 y 0032).
 */
import { CancellationReason, type CancellationReasonValue } from './cancellations';
import { Currency } from './enums';

/** Antelación mínima sobre el inicio del tour para tener derecho a reembolso. */
export const CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Comisión de OnvoPay por cobro con tarjeta (spec 0032): 3,9 % + US$0,35 según
 * https://onvopay.com/pricing (2026-09-21). Es el costo TOTAL que cobra OnvoPay por transacción:
 * si se confirma que suma IVA, se ajustan estas constantes para incluirlo. Si se suma otro
 * proveedor de pagos, pasa a un mapa por proveedor y moneda.
 */
export const PROCESSING_FEE_PERCENT_BPS = 390;
export const PROCESSING_FEE_FIXED_CENTS: Partial<Record<Currency, number>> = {
  [Currency.USD]: 35,
};

/**
 * Primera versión de términos (`TERMS_VERSION`, formato `YYYY-MM-DD`) que contiene la cláusula
 * de reembolso menos comisión. En `null`, la política está inactiva y toda cancelación del
 * cliente con antelación recibe el reembolso total. Se activa en el mismo deploy que publica esos
 * términos (spec 0032 §11).
 */
export const REFUND_FEE_FROM_TERMS_VERSION: string | null = null;

const BPS_DIVISOR = 10_000;
const HALF_BPS_DIVISOR = 5_000;

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
 * Comisión de procesamiento de un cobro, en centavos. Solo aritmética entera: redondeo del
 * porcentaje al centavo más cercano (mitad hacia arriba) más la parte fija de la moneda.
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
  return percent + fixed;
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
