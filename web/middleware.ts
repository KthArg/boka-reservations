import { type NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { createSupabaseMiddlewareClient } from './lib/db/supabase-middleware';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import type { UserRole } from '@shared/constants/enums';

const intlMiddleware = createIntlMiddleware(routing);

const PROTECTED_SEGMENTS = ['/dashboard', '/bookings', '/guides', '/settings'];

function isProtectedPath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/(es|en)/, '');
  return PROTECTED_SEGMENTS.some((seg) => withoutLocale.startsWith(seg));
}

// Decodifica el claim `user_role` del access token (JWT inyectado por custom_access_token_hook).
// Edge-safe a propósito: atob + TextDecoder, sin Buffer. Falla cerrado (undefined) ante error.
function decodeUserRole(accessToken: string): UserRole | undefined {
  try {
    const b64 = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { user_role?: UserRole };
    return payload.user_role;
  } catch {
    return undefined;
  }
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

  if (isProtectedPath(pathname)) {
    const locale = pathname.split('/')[1] ?? routing.defaultLocale;
    const redirectToLogin = (): NextResponse => {
      const loginUrl = new URL(`/${locale}/login`, request.url);
      loginUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(loginUrl);
    };

    if (!user) return redirectToLogin();

    // ACCESS-02 (spec 0023): exigir rol de panel en el middleware, además de autenticar.
    // Defensa en profundidad: el choke-point real sigue siendo (admin)/layout.tsx + RLS,
    // pero el middleware ya rechaza a un authenticated sin rol antes de llegar a la ruta.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const role = session ? decodeUserRole(session.access_token) : undefined;
    if (!role || !ADMIN_PANEL_ROLES.includes(role)) return redirectToLogin();
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
