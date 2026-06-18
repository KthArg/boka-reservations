import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Estado compartido con los mocks (hoisted: el factory de vi.mock se eleva sobre los imports).
const h = vi.hoisted(() => ({
  intlRequests: [] as Request[],
  user: null as unknown,
  session: null as unknown,
}));

// next-intl: capturamos el request que recibe (para verificar que lleva el nonce en su
// header CSP, que es como Next firma sus <script>) y devolvemos una respuesta mínima.
vi.mock('next-intl/middleware', () => ({
  default: () => (req: Request) => {
    h.intlRequests.push(req);
    return new Response(null, { headers: new Headers() });
  },
}));

// Supabase: usuario/sesión controlables, sin tocar red ni DB.
vi.mock('./lib/db/supabase-middleware', () => ({
  createSupabaseMiddlewareClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user } }),
      getSession: async () => ({ data: { session: h.session } }),
    },
  }),
}));

import { middleware } from './middleware';

const REDIRECT_STATUS = 307;
const NONCE_RE = /'nonce-([^']+)'/;

function nonceOf(csp: string | null): string | undefined {
  return csp?.match(NONCE_RE)?.[1];
}

describe('middleware — CSP con nonce por request (spec 0024)', () => {
  beforeEach(() => {
    h.intlRequests = [];
    h.user = null;
    h.session = null;
  });

  it('pasa el nonce en el header CSP del request hacia el render (no sólo x-nonce)', async () => {
    await middleware(new NextRequest('http://localhost/es'));
    const reqCsp = h.intlRequests[0].headers.get('content-security-policy');
    expect(reqCsp).toContain(`'strict-dynamic'`);
    expect(nonceOf(reqCsp)).toBeTruthy();
    // x-nonce (conveniencia para Server Components) coincide con el del header CSP.
    expect(h.intlRequests[0].headers.get('x-nonce')).toBe(nonceOf(reqCsp));
  });

  it('emite en la respuesta una CSP con el mismo nonce que recibió el render', async () => {
    const res = await middleware(new NextRequest('http://localhost/es'));
    const resNonce = nonceOf(res.headers.get('content-security-policy'));
    expect(resNonce).toBeTruthy();
    expect(resNonce).toBe(nonceOf(h.intlRequests[0].headers.get('content-security-policy')));
  });

  it('genera un nonce distinto en cada request', async () => {
    const a = await middleware(new NextRequest('http://localhost/es'));
    const b = await middleware(new NextRequest('http://localhost/es'));
    expect(nonceOf(a.headers.get('content-security-policy'))).not.toBe(
      nonceOf(b.headers.get('content-security-policy')),
    );
  });

  it('el redirect de una ruta protegida sin sesión también lleva la CSP', async () => {
    h.user = null;
    const res = await middleware(new NextRequest('http://localhost/es/dashboard'));
    expect(res.status).toBe(REDIRECT_STATUS);
    expect(nonceOf(res.headers.get('content-security-policy'))).toBeTruthy();
  });
});
