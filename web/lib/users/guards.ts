import { UserRole } from '@shared/constants/enums';
import { UserManagementError } from '@shared/constants/users';

type DeactivationCheck = {
  targetId: string;
  targetRole: UserRole;
  targetActive: boolean;
  currentUserId: string;
  activeAdminCount: number;
};

/**
 * Reglas para desactivar un usuario (spec 0010 §4). Función pura para poder
 * testearla sin DB:
 * - nadie puede desactivarse a sí mismo (evita lockout)
 * - no se puede desactivar al último admin activo (el sistema siempre debe
 *   tener ≥1 admin activo)
 *
 * Devuelve el error que aplica, o null si la desactivación es válida.
 */
export function checkDeactivation(c: DeactivationCheck): UserManagementError | null {
  if (c.targetId === c.currentUserId) return UserManagementError.SelfDeactivation;
  if (c.targetRole === UserRole.Admin && c.targetActive && c.activeAdminCount <= 1) {
    return UserManagementError.LastAdmin;
  }
  return null;
}
