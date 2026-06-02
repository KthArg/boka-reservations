import type { Tables } from '@/types/database';
import type { UserRole } from '@shared/constants/enums';
import type { UserManagementError } from '@shared/constants/users';

export type UserListItem = Pick<
  Tables<'users'>,
  'id' | 'email' | 'role' | 'full_name' | 'phone' | 'active' | 'locale'
>;

export type UserFilters = {
  role?: UserRole;
  active?: boolean;
};

/** Las claves de error son códigos i18n que el cliente traduce con fallback. */
export type FieldErrors = { _form?: string[] } & Partial<Record<string, string[]>>;

/** Resultado de los formularios (alta/edición). En éxito redirigen, sin payload. */
export type FormResult = { success: true } | { success: false; errors: FieldErrors };

/** Resultado de las acciones de botón (activar/desactivar, reenviar invitación). */
export type UserActionResult = { ok: true } | { ok: false; error: UserManagementError };
