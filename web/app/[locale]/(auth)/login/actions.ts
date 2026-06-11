'use server';

import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  redirectTo: z.string().optional(),
});

export async function signIn(formData: FormData) {
  const locale = await getLocale();

  const result = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    redirectTo: formData.get('redirectTo') || undefined,
  });

  if (!result.success) {
    redirect(`/${locale}/login?error=invalid-credentials`);
  }

  const { email, password, redirectTo } = result.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/${locale}/login?error=invalid-credentials`);
  }

  redirect(safeRedirectPath(redirectTo, `/${locale}/dashboard`));
}
