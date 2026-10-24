'use server';

import { cookies } from 'next/headers';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { verifyInviteSet } from '@/lib/auth/invite-set-token';
import { PasswordSchema } from '@/lib/auth/password-policy';
import { INVITE_SET_COOKIE } from '@shared/constants/users';
import type { AuthError } from '@supabase/supabase-js';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const UpdatePasswordSchema = z.object({
  password: PasswordSchema,
});

const WEAK_PASSWORD_CODE = 'weak_password';

/** Auth rechazó la contraseña por su política: se muestra como contraseña inválida, no como falla. */
function failureParam(error: AuthError): string {
  return error.code === WEAK_PASSWORD_CODE ? 'invalid-password' : 'update-failed';
}

export async function updatePassword(formData: FormData) {
  const locale = await getLocale();

  const result = UpdatePasswordSchema.safeParse({
    password: formData.get('password'),
  });

  if (!result.success) {
    redirect(`/${locale}/reset-password?error=invalid-password`);
  }

  const cookieStore = await cookies();
  const inviteUid = verifyInviteSet(cookieStore.get(INVITE_SET_COOKIE)?.value);

  // Flujo de invitación (admin/staff): fija la contraseña vía service client,
  // identificando al usuario con la cookie firmada que emitió /auth/confirm. No
  // depende de la sesión del navegador (que en el navegador real no sobrevivía
  // hasta este POST). El usuario luego inicia sesión con su nueva contraseña.
  if (inviteUid) {
    const service = createSupabaseServiceClient();
    const { error } = await service.auth.admin.updateUserById(inviteUid, {
      password: result.data.password,
    });
    if (error) {
      // La cookie se conserva: con una contraseña válida, el invitado reintenta sin otro enlace.
      console.error('[reset-password] no se pudo fijar la contraseña del invitado:', error.message);
      redirect(`/${locale}/reset-password?error=${failureParam(error)}`);
    }
    cookieStore.delete(INVITE_SET_COOKIE);
    redirect(`/${locale}/login?reset=success`);
  }

  // Sin la cookie firmada de /auth/confirm o /auth/callback no se cambia ninguna contraseña: una
  // sesión cualquiera no alcanza (spec 0049; con la contraseña robada se saltearía el segundo
  // factor, que es lo que GoTrue impide con `insufficient_aal`).
  redirect(`/${locale}/forgot-password?error=link-expired`);
}
