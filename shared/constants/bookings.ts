import { Currency, UserRole } from './enums';

/** Acción del toggle de check-in sobre una reserva (spec 0008). */
export enum CheckInAction {
  CheckIn = 'check_in',
  Revert = 'revert',
}

/** Roles con acceso al panel de reservas y al check-in. */
export const ADMIN_PANEL_ROLES: readonly UserRole[] = [UserRole.Admin, UserRole.Staff];

/** Filas por página en la lista de reservas del panel. */
export const ADMIN_BOOKINGS_PAGE_SIZE = 50;

/** Rango máximo (en días) permitido al exportar reservas a CSV. */
export const EXPORT_MAX_RANGE_DAYS = 366;

/** Motivos por los que un export puede rechazarse (responde 400). */
export enum ExportRangeError {
  Missing = 'export_range_missing',
  /** `from > to` (spec 0028, B8): su propio código para no reportar "falta el rango". */
  Inverted = 'export_range_inverted',
  TooLong = 'export_range_too_long',
}

/** Motivos por los que el toggle de check-in puede rechazarse. */
export enum CheckInError {
  Unauthorized = 'checkin_unauthorized',
  NotFound = 'checkin_not_found',
  NotConfirmed = 'checkin_not_confirmed',
  WriteFailed = 'checkin_write_failed',
}

/** Offset horario del operador (Costa Rica, UTC-6, sin horario de verano). */
export const OPERATOR_UTC_OFFSET_HOURS = -6;

/** Centavos por unidad de moneda (para mostrar montos en unidad mayor). */
export const CENTS_PER_UNIT = 100;

/** Cookie HttpOnly que prueba la propiedad del hold durante el checkout (spec 0023,
 *  ACCESS-03). Deduplicada acá en el spec 0028 (vivía copiada en checkout-action y en
 *  la página de cancelación). */
export const HOLD_SESSION_COOKIE = 'hold_session';

/**
 * Horas durante las que /checkout/success muestra los datos de la reserva, contadas desde su
 * creación o desde el último inicio de cobro, lo más reciente (spec 0031 §5.3). Pasado el plazo
 * la página muestra el mensaje genérico: el comprobante permanente es el correo.
 */
export const SUCCESS_PAGE_WINDOW_HOURS = 24;

/** Moneda de los dos checkouts (widget y cobro diferido): hoy siempre USD (spec 0032 §5.3). */
export const CHECKOUT_CURRENCY = Currency.USD;
