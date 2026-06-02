import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { env } from '@/lib/env';
import { UserRole } from '@shared/constants/enums';
import { UserManagementError } from '@shared/constants/users';
import type { UserCreateInput } from '@shared/schemas';
import type { UserActionResult } from './types';

function inviteRedirectTo(locale: string): string {
  return `${env.APP_URL}/${locale}/reset-password`;
}

/**
 * Alta de usuario interno (spec 0010). Dos caminos según si el usuario inicia
 * sesión:
 * - guía: solo public.users (sin cuenta de auth; accede por el magic link de 0009).
 * - admin/staff: inviteUserByEmail crea la cuenta de auth y dispara la invitación;
 *   luego se inserta public.users con el MISMO id. Si el insert falla, se borra la
 *   cuenta de auth recién creada (rollback manual; no hay transacción cross-schema).
 *
 * El chequeo de email duplicado se hace en la action antes de llamar acá.
 */
export async function createInternalUser(
  input: UserCreateInput,
  locale: string,
): Promise<UserActionResult> {
  const db = createSupabaseServiceClient();

  if (input.role === UserRole.Guide) {
    const { error } = await db.from('users').insert({
      email: input.email,
      role: input.role,
      full_name: input.full_name,
      phone: input.phone,
      locale: input.locale,
    });
    return error ? { ok: false, error: UserManagementError.WriteFailed } : { ok: true };
  }

  const { data, error: inviteErr } = await db.auth.admin.inviteUserByEmail(input.email, {
    data: { locale: input.locale, full_name: input.full_name, role: input.role },
    redirectTo: inviteRedirectTo(locale),
  });
  if (inviteErr || !data.user) return { ok: false, error: UserManagementError.InviteFailed };

  const { error: insErr } = await db.from('users').insert({
    id: data.user.id,
    email: input.email,
    role: input.role,
    full_name: input.full_name,
    phone: input.phone,
    locale: input.locale,
  });
  if (insErr) {
    await db.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: UserManagementError.WriteFailed };
  }
  return { ok: true };
}
