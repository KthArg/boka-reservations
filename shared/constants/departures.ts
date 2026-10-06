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
  /** Faltan menos de 24 horas: ya no se cancela por mínimo, solo por otra causa (…055). */
  MinimumTooLate: 'minimum_too_late',
} as const;

/**
 * Aviso de salidas con turistas y sin guía (spec 0043): cuántos días hacia adelante se mira, desde
 * cuántas horas la salida es urgente y cuántas muestra la bandeja como mucho. Solo los usa la web.
 */
/** Valor inicial; el vigente se configura en el panel (spec 0046). */
export const GUIDE_WARNING_HORIZON_DAYS = 14;
export const GUIDE_WARNING_URGENT_HOURS = 24;
export const GUIDE_WARNING_TRAY_LIMIT = 30;

/** Ruta del panel de salidas, compartida por las acciones que la revalidan. */
export const DEPARTURES_PATH = '/dashboard/departures';

export enum DepartureDecisionError {
  Unauthorized = 'departure_decision_unauthorized',
  /** Otra persona resolvió la salida primero. */
  AlreadyResolved = 'departure_decision_already_resolved',
  NotResolvable = 'departure_decision_not_resolvable',
  /** Hay una captura en curso sobre una reserva de la salida: reintentar en unos minutos. */
  CaptureInProgress = 'departure_decision_capture_in_progress',
  WriteFailed = 'departure_decision_write_failed',
  /** Faltan menos de 24 horas: para cancelar hay que elegir otra causa (reembolso del 100 %). */
  MinimumTooLate = 'departure_decision_minimum_too_late',
}
