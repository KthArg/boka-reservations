/** Id de la fila única de `business_settings` (spec 0029): el CHECK de DB exige id = 1. */
export const BUSINESS_SETTINGS_ID = 1;

/**
 * Rango de la ventana de decisión: horas antes de la salida en que se resuelve una salida
 * bajo el mínimo (spec 0029 §5.5). Espejo del CHECK de
 * `business_settings.minimum_decision_window_hours` (1 hora a 30 días).
 */
export const MINIMUM_DECISION_WINDOW_HOURS_MIN = 1;
export const MINIMUM_DECISION_WINDOW_HOURS_MAX = 720;

/**
 * Rango del plazo de cobro por defecto: horas antes de la salida en que se cobra un tour
 * configurado como `before_departure` sin plazo propio (spec 0033 §5.1). Espejo del CHECK de
 * `business_settings.default_charge_lead_hours`. Vive acá y no en `tours.ts` porque es la
 * columna global: el rango por tour puede divergir del global sin arrastrar al otro.
 */
export const DEFAULT_CHARGE_LEAD_HOURS_MIN = 32;
export const DEFAULT_CHARGE_LEAD_HOURS_MAX = 720;

/**
 * Tolerancia de llegada tarde antes de considerar no presentación (spec 0034). Espejo del CHECK de
 * `business_settings.no_show_tolerance_minutes`.
 */
export const NO_SHOW_TOLERANCE_MINUTES_MIN = 0;
export const NO_SHOW_TOLERANCE_MINUTES_MAX = 120;

/**
 * Anticipación mínima para reservar en línea: horas antes de la salida en que cierra la venta
 * (spec 0041). Espejo del CHECK de `business_settings.booking_cutoff_hours`; 0 = hasta la salida.
 */
export const BOOKING_CUTOFF_HOURS_MIN = 0;
export const BOOKING_CUTOFF_HOURS_MAX = 72;
export const BOOKING_CUTOFF_HOURS_DEFAULT = 3;

/**
 * Qué pasa con una salida que tiene reservas y no alcanza el mínimo (spec 0045). Espejo del CHECK
 * de `business_settings.below_minimum_policy`. Una salida sin ninguna reserva se cancela sola con
 * cualquiera de las dos.
 */
export enum BelowMinimumPolicy {
  /** Decide el staff desde Salidas; si nadie decide, la salida se hace. */
  StaffDecides = 'staff_decides',
  /** Se cancela sola, con el aviso de 24 horas y reembolso del 100 %. */
  AutoCancel = 'auto_cancel',
}

/** Largo máximo de cada dato del operador: son textos de una línea para el pie y los términos. */
export const OPERATOR_FIELD_MAX_LENGTH = 200;

/** Códigos de error de la action de configuración; la UI los traduce (`settings.errors.*`). */
export enum SettingsActionError {
  Unauthorized = 'settings_unauthorized',
  WindowOutOfRange = 'settings_window_out_of_range',
  LeadHoursOutOfRange = 'settings_lead_hours_out_of_range',
  UpdateFailed = 'settings_update_failed',
  /** Algún dato del operador no es válido (correo mal escrito, texto demasiado largo). */
  OperatorInvalid = 'settings_operator_invalid',
  ToleranceOutOfRange = 'settings_tolerance_out_of_range',
  /** Anticipación mínima fuera de rango (spec 0041). */
  CutoffOutOfRange = 'settings_cutoff_out_of_range',
  /** Política de salidas bajo el mínimo desconocida (spec 0045). */
  PolicyInvalid = 'settings_policy_invalid',
}
