'use server';

import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const UpdatePasswordSchema = z.object({
  password: z.string().min(8),
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
  const { error } = await supabase.auth.updateUser({
    password: result.data.password,
  });

  if (error) {
    redirect(`/${locale}/reset-password?error=update-failed`);
  }

  redirect(`/${locale}/dashboard`);
}
