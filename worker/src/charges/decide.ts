// Decisiones puras del cobro diferido (spec 0029 §5.5, §5.7 y §5.9). Sin DB ni red: los jobs
// traen los datos, esto decide y los jobs ejecutan. Mantenerlo puro es lo que permite testear
// cada fila de la tabla del watchdog sin montar OnvoPay.

/** Estados de un payment intent de OnvoPay (OpenAPI, verificado en sandbox). */
export const IntentStatus = {
  RequiresPaymentMethod: 'requires_payment_method',
  RequiresAction: 'requires_action',
  Processing: 'processing',
  Succeeded: 'succeeded',
  Canceled: 'canceled',
  Failed: 'failed',
  /**
   * No es un estado de OnvoPay: el GET devolvió 404. El intent no existe para esta llave, así que
   * no puede cobrar en esta cuenta; se trata como cerrado y se alerta (llave o entorno cruzados).
   */
  NotFound: 'not_found',
} as const;

/** Estado de un intent leído por GET; `null` es el 404 del cliente. */
export function intentStatusOf(snapshot: { status: string } | null): string {
  return snapshot?.status ?? IntentStatus.NotFound;
}

/** Estados en los que el intent todavía puede cobrar y conviene cancelarlo en OnvoPay. */
export function isConfirmable(status: string): boolean {
  return status === IntentStatus.RequiresAction || status === IntentStatus.RequiresPaymentMethod;
}

const CLOSED = [IntentStatus.Canceled, IntentStatus.Failed, IntentStatus.NotFound] as const;
export type ClosedIntentStatus = (typeof CLOSED)[number];

export function isClosedIntentStatus(status: string): status is ClosedIntentStatus {
  return (CLOSED as readonly string[]).includes(status);
}

/** Un cobro en processing más de esto se alerta con nivel error y nunca se cancela. */
export const STUCK_PROCESSING_AFTER_MS = 24 * 60 * 60 * 1000;

export enum WatchAction {
  Wait = 'wait',
  Confirm = 'confirm',
  AlertStuck = 'alert_stuck',
  AlertUnexpected = 'alert_unexpected',
  RegisterAction = 'register_action',
  CancelActionExpired = 'cancel_action_expired',
  CancelRecoveryExpired = 'cancel_recovery_expired',
  CancelDepartureStarted = 'cancel_departure_started',
  RecordRetryable = 'record_retryable',
  RecordTerminal = 'record_terminal',
}

export type InFlightTimes = {
  chargeStartedAt: Date;
  awaitingActionUntil: Date | null;
  recoveryDeadline: Date | null;
  startsAt: Date;
};

/**
 * Qué hacer con un cobro en vuelo según el GET del intent (§5.5). Orden: primero lo que el GET
 * dice que ya pasó (succeeded confirma, processing espera aunque el plazo haya vencido); después,
 * vencido un plazo, cancelar tiene precedencia sobre registrar o reintentar: registrar un rechazo
 * encolaría un "actualizá tu tarjeta" sobre una reserva que se cancela igual. Fronteras `<=`,
 * iguales a las de cancel_charge_in_flight: si difirieran, el job decidiría cancelar, la función
 * devolvería false y la reserva no avanzaría nunca.
 */
export function decideInFlight(status: string, times: InFlightTimes, now: Date): WatchAction {
  if (status === IntentStatus.Succeeded) return WatchAction.Confirm;
  if (status === IntentStatus.Processing) {
    const age = now.getTime() - times.chargeStartedAt.getTime();
    return age > STUCK_PROCESSING_AFTER_MS ? WatchAction.AlertStuck : WatchAction.Wait;
  }
  const requiresAction = status === IntentStatus.RequiresAction;
  if (
    !requiresAction &&
    status !== IntentStatus.RequiresPaymentMethod &&
    !isClosedIntentStatus(status)
  ) {
    return WatchAction.AlertUnexpected;
  }

  if (times.startsAt <= now) return WatchAction.CancelDepartureStarted;
  if (requiresAction && times.awaitingActionUntil !== null) {
    return times.awaitingActionUntil > now ? WatchAction.Wait : WatchAction.CancelActionExpired;
  }
  if (times.recoveryDeadline !== null && times.recoveryDeadline <= now) {
    return WatchAction.CancelRecoveryExpired;
  }
  if (requiresAction) return WatchAction.RegisterAction;
  return isClosedIntentStatus(status) ? WatchAction.RecordTerminal : WatchAction.RecordRetryable;
}

export enum SweepAction {
  Wait = 'wait',
  Confirm = 'confirm',
  Cancel = 'cancel',
  MarkClosed = 'mark_closed',
  AlertUnexpected = 'alert_unexpected',
}

/** Qué hacer con un intent de una reserva cancelada que todavía no se cerró (§5.9). */
export function decideSweep(status: string): SweepAction {
  if (status === IntentStatus.Succeeded) return SweepAction.Confirm;
  if (status === IntentStatus.Processing) return SweepAction.Wait;
  if (isConfirmable(status)) return SweepAction.Cancel;
  return isClosedIntentStatus(status) ? SweepAction.MarkClosed : SweepAction.AlertUnexpected;
}

export enum UnpaidCancelAction {
  Cancel = 'cancel',
  Settle = 'settle',
  Wait = 'wait',
  AlertUnexpected = 'alert_unexpected',
}

/**
 * Antes de cancelar una reserva sin cobrar que conserva un intent (§5.5, primero el GET): pudo
 * haber liquidado con el webhook perdido. Liquidado se asienta; en processing se espera.
 */
export function decideUnpaidCancel(status: string): UnpaidCancelAction {
  if (status === IntentStatus.Succeeded) return UnpaidCancelAction.Settle;
  if (status === IntentStatus.Processing) return UnpaidCancelAction.Wait;
  if (isConfirmable(status) || isClosedIntentStatus(status)) return UnpaidCancelAction.Cancel;
  return UnpaidCancelAction.AlertUnexpected;
}
