'use server';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { verifyInviteSet } from '@/lib/auth/invite-set-token';
import { INVITE_SET_COOKIE } from '@shared/constants/users';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const MIN_PASSWORD_LENGTH = 8;

const UpdatePasswordSchema = z.object({
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

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
    cookieStore.delete(INVITE_SET_COOKIE);
    if (error) redirect(`/${locale}/reset-password?error=update-failed`);
    redirect(`/${locale}/login?reset=success`);
  }

  // Flujo forgot-password (self-service: el usuario reseteó su propia sesión).
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({
    password: result.data.password,
  });

  if (error) {
    redirect(`/${locale}/reset-password?error=update-failed`);
  }

  redirect(`/${locale}/dashboard`);
}
