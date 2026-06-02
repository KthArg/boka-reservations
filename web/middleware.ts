import { type NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { createSupabaseMiddlewareClient } from './lib/db/supabase-middleware';

const intlMiddleware = createIntlMiddleware(routing);

const PROTECTED_SEGMENTS = ['/dashboard', '/bookings', '/guides', '/settings'];

function isProtectedPath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/(es|en)/, '');
  return PROTECTED_SEGMENTS.some((seg) => withoutLocale.startsWith(seg));
}

export async function middleware(request: NextRequest) {
  // next-intl produce la respuesta (rewrite de locale, etc.) y enganchamos el
  // cliente de Supabase a ESA respuesta: así el refresh de cookies que hace
  // getUser() persiste al navegador. Antes se devolvía intlMiddleware(request)
  // descartando el response con las cookies refrescadas, lo que dejaba que la
  // sesión se perdiera al expirar el access token.
  const response = intlMiddleware(request);
  const supabase = createSupabaseMiddlewareClient(request, response);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (isProtectedPath(pathname) && !user) {
    const locale = pathname.split('/')[1] ?? routing.defaultLocale;
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
