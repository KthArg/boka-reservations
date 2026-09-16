import { ConfirmBookingOutcome } from '@shared/constants/enums';

// Qué alertar según el outcome de confirm_booking en el webhook (specs 0028, 0029). Separado del
// handler: la ruta verifica y persiste; esto decide la severidad. Plata que requiere acción
// manual va con nivel error.

export type OutcomeAlert = {
  message: string;
  fingerprint: string;
  level: 'warning' | 'error';
};

const MANUAL_REFUND_MESSAGE =
  '[webhook] cobro que requiere reembolso manual (doble cobro o refund bloqueado)';

const ALERTS: Record<ConfirmBookingOutcome, OutcomeAlert | null> = {
  [ConfirmBookingOutcome.Confirmed]: null,
  [ConfirmBookingOutcome.AlreadyProcessed]: null,
  [ConfirmBookingOutcome.OverbookedRefunded]: {
    message: '[webhook] cupo agotado al confirmar: reserva auto-reembolsada',
    fingerprint: 'booking-overbooked-refunded',
    level: 'warning',
  },
  // Pago tardío sobre una reserva cancelada (p. ej. staleness): la RPC ya encoló el refund total.
  [ConfirmBookingOutcome.LatePaymentRefunded]: {
    message: '[webhook] pago tardío sobre reserva cancelada: refund total encolado',
    fingerprint: 'webhook-late-payment-refunded',
    level: 'warning',
  },
  // Un segundo intent sobre una reserva ya resuelta (spec 0029 §5.6).
  [ConfirmBookingOutcome.DuplicatePayment]: {
    message: MANUAL_REFUND_MESSAGE,
    fingerprint: 'webhook-duplicate-payment',
    level: 'error',
  },
  // Pago tardío con otro refund activo: no vuelve solo (spec 0029).
  [ConfirmBookingOutcome.LatePaymentRefundBlocked]: {
    message: MANUAL_REFUND_MESSAGE,
    fingerprint: 'webhook-late-payment-refund-blocked',
    level: 'error',
  },
  // Diferida confirmada sin haber pasado por el cobro (spec 0029 §5.3): revisar el origen.
  [ConfirmBookingOutcome.ConfirmedUnclaimed]: {
    message: '[webhook] reserva diferida confirmada sin cobro iniciado',
    fingerprint: 'webhook-confirmed-unclaimed',
    level: 'warning',
  },
  // El handler ya validó el monto; si la función igual marca mismatch, la fila cambió.
  [ConfirmBookingOutcome.PaymentMismatch]: {
    message: '[webhook] pago con monto/moneda no coincidente',
    fingerprint: 'webhook-payment-mismatch',
    level: 'error',
  },
  [ConfirmBookingOutcome.Ignored]: {
    message: '[webhook] pago recibido en estado no accionable: revisión manual',
    fingerprint: 'webhook-ignored-status',
    level: 'warning',
  },
};

const UNKNOWN_OUTCOME_ALERT: OutcomeAlert = {
  message: '[webhook] outcome desconocido de confirm_booking: revisión manual',
  fingerprint: 'webhook-unknown-outcome',
  level: 'error',
};

function isKnownOutcome(outcome: string): outcome is ConfirmBookingOutcome {
  return Object.prototype.hasOwnProperty.call(ALERTS, outcome);
}

/** Alerta para el outcome, o null si no hay nada que avisar. Un outcome desconocido nunca calla. */
export function webhookOutcomeAlert(outcome: string | null): OutcomeAlert | null {
  if (outcome === null || !isKnownOutcome(outcome)) return UNKNOWN_OUTCOME_ALERT;
  return ALERTS[outcome];
}
