import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { env } from '@/lib/env';
import { UserRole } from '@shared/constants/enums';
import { LOGIN_ROLES, UserManagementError } from '@shared/constants/users';
import type { UserUpdateInput } from '@shared/schemas';
import { checkDeactivation } from './guards';
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

  if (!active) {
    const guard = checkDeactivation({
      targetId: id,
      targetRole: target.role as UserRole,
      targetActive: target.active,
      currentUserId,
      activeAdminCount: await countActiveAdmins(),
    });
    if (guard) return { ok: false, error: guard };
  }

  const db = createSupabaseServiceClient();
  const { error } = await db.from('users').update({ active }).eq('id', id);
  return error ? { ok: false, error: UserManagementError.WriteFailed } : { ok: true };
}

/** Reenvía la invitación a un admin/staff que aún no fijó contraseña. */
export async function resendInvite(id: string, locale: string): Promise<UserActionResult> {
  const target = await getUserById(id);
  if (!target) return { ok: false, error: UserManagementError.NotFound };
  if (!LOGIN_ROLES.includes(target.role as UserRole)) {
    return { ok: false, error: UserManagementError.InviteFailed };
  }

  const db = createSupabaseServiceClient();
  const { error } = await db.auth.admin.inviteUserByEmail(target.email, {
    data: { locale: target.locale, full_name: target.full_name, role: target.role },
    redirectTo: `${env.APP_URL}/${locale}/reset-password`,
  });
  return error ? { ok: false, error: UserManagementError.InviteFailed } : { ok: true };
}
