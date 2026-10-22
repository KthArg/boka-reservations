import { NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { createSupabaseMiddlewareClient } from './lib/db/supabase-middleware';
import { buildCsp, cspHeaderName } from './lib/security/csp';
import { generateNonce } from './lib/security/nonce';
import { AAL2, decodeSessionClaims, isPanelRole } from './lib/auth/session-claims';

const intlMiddleware = createIntlMiddleware(routing);

const NONCE_HEADER = 'x-nonce';
const PROTECTED_SEGMENTS = ['/dashboard', '/bookings', '/guides', '/settings'];

function isProtectedPath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/(es|en)/, '');
  return PROTECTED_SEGMENTS.some((seg) => withoutLocale.startsWith(seg));
}

export async function middleware(request: NextRequest) {
  // CSP con nonce por request (spec 0024). El nonce viaja en un request reconstruido (solo
  // headers) hacia next-intl/render, y el mismo nonce va en la CSP de la respuesta.
  const nonce = generateNonce();
  const csp = buildCsp(nonce, request.nextUrl.pathname);
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
    // Loop fix (spec 0028, B3): si el primer segmento NO es un locale válido (p. ej.
    // `/dashboard` tipeado o un bookmark), next-intl ya emitió el redirect a
    // `/{defaultLocale}{pathname}` en `response` — se devuelve tal cual y el guard corre
    // sobre la URL localizada en el request siguiente. Antes: locale='dashboard' →
    // redirect a `/dashboard/login` (también protegida) → ERR_TOO_MANY_REDIRECTS.
    const firstSegment = pathname.split('/')[1] ?? '';
    const hasLocale = (routing.locales as readonly string[]).includes(firstSegment);
    if (!hasLocale) return response;

    const locale = firstSegment;
    // Un redirect nuevo perdería las cookies que getUser() renovó en `response`: con el refresh
    // token rotado y el navegador con el viejo, GoTrue terminaría revocando la sesión.
    const redirectWithSession = (url: URL): NextResponse => {
      const redirect = NextResponse.redirect(url);
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      redirect.headers.set(cspHeader, csp);
      return redirect;
    };
    const redirectToLogin = (): NextResponse => {
      const loginUrl = new URL(`/${locale}/login`, request.url);
      loginUrl.searchParams.set('redirectTo', pathname);
      return redirectWithSession(loginUrl);
    };

    if (!user) return redirectToLogin();

    // ACCESS-02 (spec 0023): exigir rol de panel en el middleware (defensa en profundidad;
    // el choke-point real es (admin)/layout.tsx + RLS).
    const claims = accessToken ? decodeSessionClaims(accessToken) : undefined;
    if (!claims || !isPanelRole(claims.userRole)) return redirectToLogin();

    // Spec 0049: sin el segundo factor verificado en esta sesión, primero /mfa.
    if (claims.aal !== AAL2) {
      const mfaUrl = new URL(`/${locale}/mfa`, request.url);
      mfaUrl.searchParams.set('redirectTo', pathname);
      return redirectWithSession(mfaUrl);
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
