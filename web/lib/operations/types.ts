import type { OperationError } from '@shared/constants/operations';

/** Resultado de las acciones del panel del spec 0035. */
export type OperationResult = { ok: true } | { ok: false; error: OperationError };

/** Ruta del detalle de reservas, que estas acciones revalidan. */
export const BOOKINGS_ADMIN_PATH = '/dashboard/bookings';
