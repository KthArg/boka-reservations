import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { signInviteSet } from '@/lib/auth/invite-set-token';
import { INVITE_SET_COOKIE, INVITE_SET_TTL_MS } from '@shared/constants/users';
import { type NextRequest, NextResponse } from 'next/server';
import { resolveRouteLocale } from '@/lib/i18n/route-locale';

type Params = { params: Promise<{ locale: string }> };

const MS_PER_SECOND = 1000;

export async function GET(request: NextRequest, { params }: Params) {
  const locale = resolveRouteLocale((await params).locale);
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(
      new URL(`/${locale}/forgot-password?error=link-expired`, request.url),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL(`/${locale}/forgot-password?error=link-expired`, request.url),
    );
  }

  // Spec 0049: la recuperación prueba que la persona controla el correo, no que tiene el segundo
  // factor. Como en /auth/confirm, se emite la cookie firmada con el id verificado y se cierra la
  // sesión: /reset-password fija la contraseña con esa cookie, nunca con una sesión cualquiera
  // (eso dejaría cambiarla con la contraseña robada y sin segundo factor).
  await supabase.auth.signOut({ scope: 'local' });
  const response = NextResponse.redirect(new URL(`/${locale}/reset-password`, request.url));
  response.cookies.set(INVITE_SET_COOKIE, signInviteSet(data.user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: INVITE_SET_TTL_MS / MS_PER_SECOND,
  });
  return response;
}
