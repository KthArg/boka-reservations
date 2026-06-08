import { UserRole } from './enums';

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
