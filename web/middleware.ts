import { NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { buildCsp, cspHeaderName } from './lib/security/csp';
import { generateNonce } from './lib/security/nonce';

const intlMiddleware = createIntlMiddleware(routing);

const NONCE_HEADER = 'x-nonce';
const PROTECTED_SEGMENTS = ['/dashboard', '/bookings', '/guides', '/settings'];

// Roles del panel, inlineados a strings A PROPÓSITO: el middleware corre en Edge y su bundler no
// puede incluir módulos fuera del root del web (`@shared`). Debe coincidir con
// shared/constants/bookings.ts → [UserRole.Admin, UserRole.Staff].
const ADMIN_PANEL_ROLES: readonly string[] = ['admin', 'staff'];

function isProtectedPath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/(es|en)/, '');
  return PROTECTED_SEGMENTS.some((seg) => withoutLocale.startsWith(seg));
}

// Decodifica el claim `user_role` del access token (JWT del custom_access_token_hook).
// Edge-safe: atob + TextDecoder, sin Buffer. Falla cerrado (undefined) ante error.
function decodeUserRole(accessToken: string): string | undefined {
  try {
    const b64 = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { user_role?: string };
    return payload.user_role;
  } catch {
    return undefined;
  }
}

export async function middleware(request: NextRequest) {
  // DEBUG/ROBUSTEZ (temporal): toda la función va en try/catch para depurar un
  // MIDDLEWARE_INVOCATION_FAILED en el Edge de Vercel. Si algo tira, se loguea el error real
  // (Runtime Logs) y se degrada en vez de tirar 500 en todo el sitio. El cliente de Supabase se
  // carga con import() DINÁMICO: si el problema fuera cargar `@supabase/ssr` en el module-load del
  // edge, así sale de ahí y el fallo queda atrapado en el try interno.
  try {
    const nonce = generateNonce();
    const csp = buildCsp(nonce);
    const cspHeader = cspHeaderName();

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(cspHeader, csp);
    requestHeaders.set(NONCE_HEADER, nonce);

    const response = intlMiddleware(new NextRequest(request, { headers: requestHeaders }));
    response.headers.set(cspHeader, csp);

    const { pathname } = request.nextUrl;

    let user: unknown = null;
    let accessToken: string | undefined;
    try {
      const { createSupabaseMiddlewareClient } = await import('./lib/db/supabase-middleware');
      const supabase = createSupabaseMiddlewareClient(request, response);
      const { data } = await supabase.auth.getUser();
      user = data.user;
      if (user && isProtectedPath(pathname)) {
        const { data: s } = await supabase.auth.getSession();
        accessToken = s.session?.access_token;
      }
    } catch (err) {
      console.error(
        '[middleware] supabase error:',
        err instanceof Error ? (err.stack ?? err.message) : String(err),
      );
    }

    if (isProtectedPath(pathname)) {
      const locale = pathname.split('/')[1] ?? routing.defaultLocale;
      const redirectToLogin = (): NextResponse => {
        const loginUrl = new URL(`/${locale}/login`, request.url);
        loginUrl.searchParams.set('redirectTo', pathname);
        const redirect = NextResponse.redirect(loginUrl);
        redirect.headers.set(cspHeader, csp);
        return redirect;
      };
      if (!user) return redirectToLogin();
      const role = accessToken ? decodeUserRole(accessToken) : undefined;
      if (!role || !ADMIN_PANEL_ROLES.includes(role)) return redirectToLogin();
    }

    return response;
  } catch (err) {
    console.error(
      '[middleware] FATAL:',
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
