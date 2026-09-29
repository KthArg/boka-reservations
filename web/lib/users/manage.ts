import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { UserRole } from '@shared/constants/enums';
import { LOGIN_ROLES, UserManagementError } from '@shared/constants/users';
import type { UserUpdateInput } from '@shared/schemas';
import { checkDeactivation } from './guards';
import { isAuthUserMissing } from './auth-errors';
import { countActiveAdmins, getUserById } from './repository';
import type { UserActionResult } from './types';

/** Edita los campos permitidos (rol y email son inmutables — spec 0010 §3). */
export async function updateInternalUser(
  id: string,
  input: UserUpdateInput,
): Promise<UserActionResult> {
  const db = createSupabaseServiceClient();
  const { error } = await db
    .from('users')
    .update({ full_name: input.full_name, phone: input.phone, locale: input.locale })
    .eq('id', id);
  return error ? { ok: false, error: UserManagementError.WriteFailed } : { ok: true };
}

/** Activa/desactiva un usuario. Al desactivar aplica los guards (self / último admin). */
export async function setUserActive(
  id: string,
  active: boolean,
  currentUserId: string,
): Promise<UserActionResult> {
  const target = await getUserById(id);
  if (!target) return { ok: false, error: UserManagementError.NotFound };

  const db = createSupabaseServiceClient();

  if (!active) {
    // Ya inactivo: no-op idempotente (comportamiento previo; la RPC devolvería false
    // y se confundiría con el guard del último admin).
    if (!target.active) return { ok: true };

    // Pre-chequeo para errores amigables (self / último admin)…
    const guard = checkDeactivation({
      targetId: id,
      targetRole: target.role as UserRole,
      targetActive: target.active,
      currentUserId,
      activeAdminCount: await countActiveAdmins(),
    });
    if (guard) return { ok: false, error: guard };

    // …y desactivación ATÓMICA en DB (spec 0028, C1): el pre-chequeo tenía TOCTOU —
    // dos desactivaciones concurrentes de los dos últimos admins dejaban 0 admins
    // (lockout, el sistema es invite-only). La RPC serializa con FOR UPDATE y
    // devuelve false si el guard del último admin bloquea en la carrera.
    const { data: deactivated, error } = await db.rpc('deactivate_internal_user', {
      p_user_id: id,
    });
    if (error) return { ok: false, error: UserManagementError.WriteFailed };
    if (!deactivated) return { ok: false, error: UserManagementError.LastAdmin };
    await setSessionsBlocked(db, target.role, id, true);
    return { ok: true };
  }

  // Reactivar a alguien cuya cuenta de acceso ya no existe dejaría una fila activa sin forma de
  // entrar (spec 0038): se avisa antes de escribir.
  if (LOGIN_ROLES.includes(target.role as UserRole)) {
    const { data, error: lookupError } = await db.auth.admin.getUserById(id);
    if (isAuthUserMissing(lookupError) || (!lookupError && !data.user)) {
      return { ok: false, error: UserManagementError.AccountMissing };
    }
    if (lookupError) {
      console.error('[users] no se pudo leer la cuenta al reactivar:', lookupError.code, id);
      return { ok: false, error: UserManagementError.WriteFailed };
    }
  }

  const { error } = await db.from('users').update({ active }).eq('id', id);
  if (error) return { ok: false, error: UserManagementError.WriteFailed };
  // Si el desbloqueo en Auth falla, el usuario seguiría sin poder entrar: se informa.
  const unblocked = await setSessionsBlocked(db, target.role, id, false);
  return unblocked ? { ok: true } : { ok: false, error: UserManagementError.WriteFailed };
}

/** Bloqueo indefinido en Supabase Auth: sin él, la sesión abierta seguiría renovándose. */
const BLOCKED_BAN_DURATION = '876000h';
const UNBLOCKED_BAN_DURATION = 'none';

/**
 * Corta las sesiones de un usuario desactivado (spec 0036): el bloqueo en Auth impide renovar el
 * token y volver a entrar. El hook del token (…050) ya le niega el token nuevo; esto cierra la
 * puerta también en Auth. Los guías no tienen cuenta de Auth: entran por enlace.
 */
async function setSessionsBlocked(
  db: ReturnType<typeof createSupabaseServiceClient>,
  role: string,
  id: string,
  blocked: boolean,
): Promise<boolean> {
  if (!LOGIN_ROLES.includes(role as UserRole)) return true;
  const { error } = await db.auth.admin.updateUserById(id, {
    ban_duration: blocked ? BLOCKED_BAN_DURATION : UNBLOCKED_BAN_DURATION,
  });
  if (error) {
    console.error('[users] no se pudo actualizar el bloqueo de sesión:', error.message, id);
    return false;
  }
  return true;
}
