import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { signInviteSet } from '@/lib/auth/invite-set-token';
import { INVITE_SET_COOKIE, INVITE_SET_TTL_MS } from '@shared/constants/users';
import type { EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

type Params = { params: Promise<{ locale: string }> };

const DEFAULT_NEXT = '/reset-password';
const ALLOWED_TYPES: readonly EmailOtpType[] = ['invite', 'recovery'];
const MS_PER_SECOND = 1000;

/**
 * Completa una invitación (o recovery) verificando el OTP del email con
 * `verifyOtp({ token_hash })` — patrón server-side de Supabase, no depende del
 * browser que abrió el link (spec 0010).
 *
 * Tras verificar, emite la cookie firmada INVITE_SET_COOKIE con el id del usuario
 * verificado: /reset-password la usa para fijar la contraseña vía service client,
 * sin depender de que la sesión del navegador sobreviva la navegación + POST (lo
 * que en el navegador real fallaba: la sesión del invitado no llegaba al submit).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { locale } = await params;
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? DEFAULT_NEXT;

  const expired = new URL(`/${locale}/forgot-password?error=link-expired`, request.url);
  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    return NextResponse.redirect(expired);
  }

  const supabase = await createSupabaseServerClient();
  // Limpia cualquier sesión previa del navegador en este origen (p. ej. un admin
  // logueado) antes de verificar el OTP.
  await supabase.auth.signOut({ scope: 'local' });

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.user) return NextResponse.redirect(expired);

  const target = next.startsWith('/') ? next : `/${next}`;
  const response = NextResponse.redirect(new URL(`/${locale}${target}`, request.url));
  response.cookies.set(INVITE_SET_COOKIE, signInviteSet(data.user.id), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: INVITE_SET_TTL_MS / MS_PER_SECOND,
  });
  return response;
}
