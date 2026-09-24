/**
 * Decisión del staff sobre el mínimo de una salida (spec 0033 §5.5). El panel elige entre dos
 * acciones; la función SQL las recibe como resoluciones.
 */
export const DepartureDecision = {
  Confirm: 'confirm',
  Cancel: 'cancel',
} as const;

export type DepartureDecisionValue = (typeof DepartureDecision)[keyof typeof DepartureDecision];

/** Resoluciones del mínimo de una salida, tal como las guarda `tour_instances`. */
export const DepartureResolution = {
  Reached: 'reached',
  AutoCancelled: 'auto_cancelled',
  StaffConfirmed: 'staff_confirmed',
  StaffCancelled: 'staff_cancelled',
} as const;

export type DepartureResolutionValue =
  (typeof DepartureResolution)[keyof typeof DepartureResolution];

/** Resultado de resolve_departure_minimum. */
export const DepartureResolutionOutcome = {
  Resolved: 'resolved',
  AlreadyResolved: 'already_resolved',
  InvalidResolution: 'invalid_resolution',
  /** El worker está capturando una reserva de la salida: resolver ahora movería plata a ciegas. */
  CaptureInProgress: 'capture_in_progress',
} as const;

/** Ruta del panel de salidas, compartida por las acciones que la revalidan. */
export const DEPARTURES_PATH = '/dashboard/departures';

export enum DepartureDecisionError {
  Unauthorized = 'departure_decision_unauthorized',
  /** Otra persona, o la red terminal del worker, resolvió la salida primero. */
  AlreadyResolved = 'departure_decision_already_resolved',
  NotResolvable = 'departure_decision_not_resolvable',
  /** Hay una captura en curso sobre una reserva de la salida: reintentar en unos minutos. */
  CaptureInProgress = 'departure_decision_capture_in_progress',
  WriteFailed = 'departure_decision_write_failed',
}
