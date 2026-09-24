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
export const DEFAULT_CHARGE_LEAD_HOURS_MIN = 1;
export const DEFAULT_CHARGE_LEAD_HOURS_MAX = 720;

/** Códigos de error de la action de configuración; la UI los traduce (`settings.errors.*`). */
export enum SettingsActionError {
  Unauthorized = 'settings_unauthorized',
  WindowOutOfRange = 'settings_window_out_of_range',
  LeadHoursOutOfRange = 'settings_lead_hours_out_of_range',
  UpdateFailed = 'settings_update_failed',
}
