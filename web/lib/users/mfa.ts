import 'server-only';
import { randomBytes } from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { writeAuditLog } from '@/lib/audit/log';
import { AuditAction, AuditActorType, AuditEntityType } from '@shared/constants/audit';
import { UserRole } from '@shared/constants/enums';
import { LOGIN_ROLES, UserManagementError } from '@shared/constants/users';
import { getUserById } from './repository';
import { resendInvite } from './resend-invite';
import type { UserActionResult } from './types';

// Segundo factor de los usuarios del panel visto por el admin (spec 0049 §5.2).

const RANDOM_PASSWORD_BYTES = 32;

/** Ids, de entre los dados, que tienen al menos un factor (verificado o no). Pocos usuarios. */
export async function usersWithMfa(ids: readonly string[]): Promise<Set<string>> {
  const db = createSupabaseServiceClient();
  const results = await Promise.all(
    ids.map(async (userId) => {
      const { data, error } = await db.auth.admin.mfa.listFactors({ userId });
      if (error) console.error('[users] no se pudieron leer los factores:', error.code, userId);
      return (data?.factors.length ?? 0) > 0 ? userId : null;
    }),
  );
  return new Set(results.filter((id): id is string => id !== null));
}

/**
 * Resetea el segundo factor de un usuario del panel que perdió el teléfono. Para que re-enrolar
 * exija controlar el correo, también reemplaza la contraseña por una aleatoria (lo que revoca sus
 * sesiones, Fase 0 del spec 0049) y le manda el correo de acceso. Idempotente.
 */
export async function resetUserMfa(
  targetId: string,
  adminId: string,
  locale: string,
): Promise<UserActionResult> {
  const target = await getUserById(targetId);
  if (!target) return { ok: false, error: UserManagementError.NotFound };
  // Solo cuentas activas del panel: un guía no tiene cuenta, y a una desactivada Auth la tiene
  // bloqueada (el correo de acceso no le serviría).
  if (!LOGIN_ROLES.includes(target.role as UserRole)) {
    return { ok: false, error: UserManagementError.NotFound };
  }
  if (!target.active) return { ok: false, error: UserManagementError.InviteFailed };

  const db = createSupabaseServiceClient();
  const { data: listed, error: listError } = await db.auth.admin.mfa.listFactors({
    userId: targetId,
  });
  if (listError) {
    console.error('[users] mfa reset, listFactors:', listError.code, targetId);
    return { ok: false, error: UserManagementError.WriteFailed };
  }
  for (const factor of listed.factors) {
    const { error } = await db.auth.admin.mfa.deleteFactor({ id: factor.id, userId: targetId });
    if (error) {
      console.error('[users] mfa reset, deleteFactor:', error.code, targetId);
      return { ok: false, error: UserManagementError.WriteFailed };
    }
  }

  const { error: passwordError } = await db.auth.admin.updateUserById(targetId, {
    password: randomBytes(RANDOM_PASSWORD_BYTES).toString('base64url'),
  });
  if (passwordError) {
    console.error('[users] mfa reset, password:', passwordError.code, targetId);
    return { ok: false, error: UserManagementError.WriteFailed };
  }

  // El correo de acceso: con la contraseña ya cambiada, es la única forma de volver a entrar. Si
  // no sale, el admin lo reenvía con "Reenviar acceso" (no hace falta repetir el reseteo).
  const sent = await resendInvite(targetId, locale);

  await writeAuditLog(db, {
    actorType: AuditActorType.Admin,
    actorId: adminId,
    action: AuditAction.UserMfaReset,
    entityType: AuditEntityType.User,
    entityId: targetId,
    metadata: { access_email_sent: sent.ok },
  });

  return sent.ok ? sent : { ok: false, error: UserManagementError.MfaResetEmailFailed };
}
