'use server';

import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const ResetRequestSchema = z.object({
  email: z.string().email(),
});

export async function requestPasswordReset(formData: FormData) {
  const locale = await getLocale();

  const result = ResetRequestSchema.safeParse({
    email: formData.get('email'),
  });

  if (!result.success) {
    redirect(`/${locale}/forgot-password?sent=true`);
    return;
  }

  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const supabase = await createSupabaseServerClient();

  await supabase.auth.resetPasswordForEmail(result.data.email, {
    redirectTo: `${baseUrl}/${locale}/auth/callback`,
  });

  redirect(`/${locale}/forgot-password?sent=true`);
}
