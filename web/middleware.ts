import { NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { createSupabaseMiddlewareClient } from './lib/db/supabase-middleware';
import { buildCsp, cspHeaderName } from './lib/security/csp';
import { generateNonce } from './lib/security/nonce';

const intlMiddleware = createIntlMiddleware(routing);

const NONCE_HEADER = 'x-nonce';
const PROTECTED_SEGMENTS = ['/dashboard', '/bookings', '/guides', '/settings'];

// Roles del panel, inlineados a strings A PROPÓSITO: el middleware corre en el runtime Edge y su
// bundler NO puede incluir módulos fuera del root del web (`@shared` = `../shared`) → importar el
// VALOR `ADMIN_PANEL_ROLES` de @shared rompía el deploy con "Edge Function referencing unsupported
// modules". Debe coincidir con shared/constants/bookings.ts → [UserRole.Admin, UserRole.Staff].
const ADMIN_PANEL_ROLES: readonly string[] = ['admin', 'staff'];

function isProtectedPath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/(es|en)/, '');
  return PROTECTED_SEGMENTS.some((seg) => withoutLocale.startsWith(seg));
}

// Decodifica el claim `user_role` del access token (JWT inyectado por custom_access_token_hook).
// Edge-safe a propósito: atob + TextDecoder, sin Buffer. Falla cerrado (undefined) ante error.
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
  // CSP con nonce por request (spec 0024). Next firma sus <script> con el nonce que
  // encuentra en el header content-security-policy del *request* que llega al render
  // (app-render). next-intl reenvía request.headers al render, así que pasamos el
  // nonce en un request reconstruido que SÓLO sobreescribe headers (nunca el body de
  // los POST de Server Actions). El mismo nonce va en la CSP de la respuesta.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const cspHeader = cspHeaderName();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(cspHeader, csp);
  requestHeaders.set(NONCE_HEADER, nonce);

  // next-intl produce la respuesta (rewrite de locale, etc.) y enganchamos el
  // cliente de Supabase a ESA respuesta: así el refresh de cookies que hace
  // getUser() persiste al navegador. Antes se devolvía intlMiddleware(request)
  // descartando el response con las cookies refrescadas, lo que dejaba que la
  // sesión se perdiera al expirar el access token. Supabase usa el request ORIGINAL
  // (mismas cookies); el reconstruido sólo alimenta a next-intl.
  const response = intlMiddleware(new NextRequest(request, { headers: requestHeaders }));
  response.headers.set(cspHeader, csp);

  const { pathname } = request.nextUrl;

  // Auth en el middleware: getUser refresca la sesión (escribe cookies en `response`) y, para rutas
  // protegidas, se valida el rol. Envuelto en try/catch (DIAGNÓSTICO + robustez): estamos depurando
  // un MIDDLEWARE_INVOCATION_FAILED en el runtime Edge de Vercel; si el cliente de Supabase falla,
  // se loguea el error real (aparece en los Runtime Logs) y se degrada a "no autenticado" en lugar
  // de tirar 500 en TODO el sitio. (Temporal hasta cerrar la causa raíz del edge.)
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

    // ACCESS-02 (spec 0023): exigir rol de panel en el middleware, además de autenticar.
    // Defensa en profundidad: el choke-point real sigue siendo (admin)/layout.tsx + RLS.
    const role = accessToken ? decodeUserRole(accessToken) : undefined;
    if (!role || !ADMIN_PANEL_ROLES.includes(role)) return redirectToLogin();
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
