'use server';

import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isSessionMismatch } from './guard';

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

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Guard de seguridad: no cambiar la contraseña de una sesión que no es la del
  // usuario para el que se emitió el enlace (ver guard.ts). Evita que un admin
  // logueado en el mismo navegador termine cambiando SU contraseña al abrir el
  // enlace de invitación de otra persona.
  if (isSessionMismatch(formData.get('uid'), user?.id)) {
    redirect(`/${locale}/reset-password?error=session-mismatch`);
  }

  const { error } = await supabase.auth.updateUser({
    password: result.data.password,
  });

  if (error) {
    redirect(`/${locale}/reset-password?error=update-failed`);
  }

  redirect(`/${locale}/dashboard`);
}
