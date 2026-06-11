'use server';

import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';
import { rateLimitKey } from '@/lib/security/rate-limit-key';
import { RATE_LIMITS, RATE_LIMIT_KEY_PREFIX } from '@shared/constants/rate-limit';
import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  redirectTo: z.string().optional(),
});

/**
 * Rate limit del login (spec 0017): por IP y por cuenta objetivo (email). Cuenta TODOS
 * los intentos antes de verificar la contraseña (más simple y seguro que contar sólo los
 * fallidos). Devuelve true si CUALQUIERA de los dos límites se excedió; el caller redirige
 * con el MISMO error genérico de credenciales para no distinguir throttle de cuenta
 * inexistente.
 */
async function isLoginThrottled(email: string): Promise<boolean> {
  const ip = getClientIp((await headers()).get('x-forwarded-for'));
  const [byIp, byEmail] = await Promise.all([
    checkRateLimit(
      rateLimitKey(RATE_LIMIT_KEY_PREFIX.loginIp, ip),
      RATE_LIMITS.loginPerIp.limit,
      RATE_LIMITS.loginPerIp.windowSeconds,
    ),
    checkRateLimit(
      rateLimitKey(RATE_LIMIT_KEY_PREFIX.loginEmail, email),
      RATE_LIMITS.loginPerEmail.limit,
      RATE_LIMITS.loginPerEmail.windowSeconds,
    ),
  ]);
  return !byIp.ok || !byEmail.ok;
}

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

  if (await isLoginThrottled(email)) {
    redirect(`/${locale}/login?error=invalid-credentials`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/${locale}/login?error=invalid-credentials`);
  }

  redirect(safeRedirectPath(redirectTo, `/${locale}/dashboard`));
}
