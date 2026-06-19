import { NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { createSupabaseMiddlewareClient } from './lib/db/supabase-middleware';
import { buildCsp, cspHeaderName } from './lib/security/csp';
import { generateNonce } from './lib/security/nonce';

const intlMiddleware = createIntlMiddleware(routing);

const NONCE_HEADER = 'x-nonce';
const PROTECTED_SEGMENTS = ['/dashboard', '/bookings', '/guides', '/settings'];

// Roles del panel, inlineados a strings A PROPÓSITO: el middleware se bundlea aparte y en este
// monorepo (sin workspace de pnpm, `shared/` fuera del root del web) importar `@shared` desde el
// middleware es frágil. Debe coincidir con shared/constants/bookings.ts → [UserRole.Admin, UserRole.Staff].
const ADMIN_PANEL_ROLES: readonly string[] = ['admin', 'staff'];

function isProtectedPath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/(es|en)/, '');
  return PROTECTED_SEGMENTS.some((seg) => withoutLocale.startsWith(seg));
}

// Decodifica el claim `user_role` del access token (JWT del custom_access_token_hook).
// Usa atob + TextDecoder (sin Buffer). Falla cerrado (undefined) ante error.
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
  // CSP con nonce por request (spec 0024). El nonce viaja en un request reconstruido (solo
  // headers) hacia next-intl/render, y el mismo nonce va en la CSP de la respuesta.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const cspHeader = cspHeaderName();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(cspHeader, csp);
  requestHeaders.set(NONCE_HEADER, nonce);

  // next-intl produce la respuesta (rewrite de locale) y enganchamos el cliente de Supabase a ESA
  // respuesta: el refresh de cookies de getUser() persiste al navegador.
  const response = intlMiddleware(new NextRequest(request, { headers: requestHeaders }));
  response.headers.set(cspHeader, csp);

  const { pathname } = request.nextUrl;

  // Auth: getUser refresca la sesión; para rutas protegidas se valida el rol. Envuelto en try/catch
  // por robustez: si el cliente de Supabase fallara, se loguea y se degrada a "no autenticado"
  // (fail-closed para el panel) en vez de tirar 500 en todo el sitio.
  let user: unknown = null;
  let accessToken: string | undefined;
  try {
    const supabase = createSupabaseMiddlewareClient(request, response);
    const { data } = await supabase.auth.getUser();
    user = data.user;
    if (user && isProtectedPath(pathname)) {
      const { data: s } = await supabase.auth.getSession();
      accessToken = s.session?.access_token;
    }
  } catch (err) {
    console.error(
      '[middleware] supabase auth error:',
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

    // ACCESS-02 (spec 0023): exigir rol de panel en el middleware (defensa en profundidad;
    // el choke-point real es (admin)/layout.tsx + RLS).
    const role = accessToken ? decodeUserRole(accessToken) : undefined;
    if (!role || !ADMIN_PANEL_ROLES.includes(role)) return redirectToLogin();
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
