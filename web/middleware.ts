import { NextResponse } from 'next/server';

// MIDDLEWARE MÍNIMO (diagnóstico): aísla un MIDDLEWARE_INVOCATION_FAILED a module-load en el Edge
// de Vercel. Sin imports más allá de next/server, sin ejecución top-level. Si esto carga, el crash
// estaba en algún import del middleware (next-intl/csp/nonce/supabase); si igual falla, es build/config.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
