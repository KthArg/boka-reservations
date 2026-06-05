/**
 * Políticas de negocio parametrizables. Aislar la regla acá permite cambiarla
 * sin tocar la lógica que la consume (spec 0011).
 */

/** Antelación mínima sobre el inicio del tour para tener derecho a reembolso. */
export const CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type RefundEligibility = {
  eligible: boolean;
  amountCents: number;
};

type ComputeRefundInput = {
  startsAt: Date;
  totalAmountCents: number;
  now: Date;
};

/**
 * Decide si una cancelación tiene derecho a reembolso y por cuánto.
 *
 * Política actual: binaria por ventana de 24h — reembolso total si la
 * cancelación ocurre con al menos `CANCELLATION_WINDOW_MS` de antelación
 * (el borde exacto cuenta como elegible), nada si es más tarde.
 *
 * TODO(política-cliente): el cliente aún no confirmó la política definitiva
 * (binaria, full-menos-comisión, o escalonada). Cambiar SOLO esta función.
 */
export function computeRefund({
  startsAt,
  totalAmountCents,
  now,
}: ComputeRefundInput): RefundEligibility {
  const leadMs = startsAt.getTime() - now.getTime();
  const eligible = leadMs >= CANCELLATION_WINDOW_MS;
  return {
    eligible,
    amountCents: eligible ? totalAmountCents : 0,
  };
}
