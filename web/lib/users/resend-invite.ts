import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { env } from '@/lib/env';
import { UserRole } from '@shared/constants/enums';
import { LOGIN_ROLES, UserManagementError } from '@shared/constants/users';
import { emailErrorFor, isAuthUserMissing } from './auth-errors';
import { getUserById } from './repository';
import type { UserActionResult } from './types';

/**
 * Reenvía el acceso a un admin/staff (spec 0038). Abrir la invitación confirma la cuenta aunque no
 * se llegue a fijar la contraseña, y desde ahí Supabase rechaza otra invitación (`email_exists`):
 * a una cuenta confirmada se le manda el correo para fijar la contraseña (plantilla de
 * recuperación, con enlace a /auth/confirm que funciona en cualquier navegador).
 */
export async function resendInvite(id: string, locale: string): Promise<UserActionResult> {
  const target = await getUserById(id);
  if (!target) return { ok: false, error: UserManagementError.NotFound };
  if (!LOGIN_ROLES.includes(target.role as UserRole)) {
    return { ok: false, error: UserManagementError.InviteFailed };
  }
  // Desactivado: Auth tiene la cuenta bloqueada y el enlace no serviría (el panel no muestra el
  // botón, esto es la segunda capa).
  if (!target.active) return { ok: false, error: UserManagementError.InviteFailed };

  const db = createSupabaseServiceClient();
  const { data: account, error: lookupError } = await db.auth.admin.getUserById(id);
  // Invitar sin cuenta crearía una con otro id y la fila del panel quedaría desalineada.
  if (isAuthUserMissing(lookupError) || (!lookupError && !account.user)) {
    return { ok: false, error: UserManagementError.AccountMissing };
  }
  if (lookupError || !account.user) {
    console.error('[users] no se pudo leer la cuenta al reenviar:', lookupError?.code, id);
    return { ok: false, error: UserManagementError.InviteFailed };
  }

  if (!account.user.email_confirmed_at) {
    const { error } = await db.auth.admin.inviteUserByEmail(target.email, {
      data: { locale: target.locale, full_name: target.full_name, role: target.role },
      redirectTo: `${env.APP_URL}/${locale}/reset-password`,
    });
    if (error) {
      console.error('[users] no se pudo reenviar la invitación:', error.code, error.message, id);
      return { ok: false, error: emailErrorFor(error) };
    }
    return { ok: true, sent: 'invite' };
  }

  const { error } = await db.auth.resetPasswordForEmail(account.user.email ?? target.email);
  if (error) {
    console.error(
      '[users] no se pudo enviar el correo de contraseña:',
      error.code,
      error.message,
      id,
    );
    return { ok: false, error: emailErrorFor(error) };
  }
  return { ok: true, sent: 'password' };
}
