/**
 * Políticas de negocio parametrizables. Aislar la regla acá permite cambiarla
 * sin tocar la lógica que la consume (specs 0011, 0032 y 0034).
 */
import { CancellationReason, type CancellationReasonValue } from './cancellations';

/** Antelación mínima sobre el inicio del tour para tener derecho a reembolso. */
export const CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Tarifa del IVA de los tours: la general de la Ley 9635. Verificado el 2026-09-27: los
 * servicios turísticos pagan el 13 % desde el 1 de julio de 2023, con o sin inscripción en el
 * ICT, al terminar el transitorio de la Ley 9882. Los precios ya la incluyen.
 */
export const VAT_RATE_PERCENT = 13;

const PERCENT = 100;

/** El IVA incluido en un precio final, en centavos, redondeado al centavo más cercano. */
export function vatIncludedCents(totalCents: number): number {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new RangeError(`Monto inválido para calcular el IVA: ${totalCents}`);
  }
  return Math.round((totalCents * VAT_RATE_PERCENT) / (PERCENT + VAT_RATE_PERCENT));
}

export type RefundEligibility = {
  eligible: boolean;
  amountCents: number;
  /**
   * Siempre 0 desde el spec 0034: los reembolsos son completos. Se conserva porque la función SQL
   * `cancel_booking` de 6 parámetros (spec 0032) lo recibe y lo valida.
   */
  feeCents: number;
};

/** Sin reembolso: fuera de la ventana, reserva sin cobrar o no confirmada. */
export const NO_REFUND: RefundEligibility = { eligible: false, amountCents: 0, feeCents: 0 };

type ComputeRefundInput = {
  startsAt: Date;
  totalAmountCents: number;
  reason: CancellationReasonValue;
  now: Date;
};

/**
 * Decide si una cancelación de una reserva cobrada tiene derecho a reembolso y por cuánto
 * (términos del 2026-09-27, cláusulas 6 y 7):
 *
 * - Por decisión del operador: el total.
 * - A pedido del cliente con 24 horas o más de antelación: el total. El borde exacto cuenta.
 * - A pedido del cliente con menos: nada. La no presentación es el mismo caso.
 *
 * Nunca se descuenta la comisión del procesador de pagos (decisión del operador, 2026-09-27).
 */
export function computeRefund({
  startsAt,
  totalAmountCents,
  reason,
  now,
}: ComputeRefundInput): RefundEligibility {
  const full: RefundEligibility = {
    eligible: totalAmountCents > 0,
    amountCents: totalAmountCents,
    feeCents: 0,
  };
  if (reason === CancellationReason.OperatorDecision) return full;

  const leadMs = startsAt.getTime() - now.getTime();
  return leadMs < CANCELLATION_WINDOW_MS ? NO_REFUND : full;
}
