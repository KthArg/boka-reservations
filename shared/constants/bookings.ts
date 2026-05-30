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
