import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { INVITE_SET_COOKIE } from '@shared/constants/users';

// /auth/callback (spec 0049): la recuperación por PKCE emite la cookie firmada con el usuario
// verificado y cierra la sesión de recuperación; /reset-password usa la cookie, no la sesión.
const h = vi.hoisted(() => ({
  exchange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { exchangeCodeForSession: h.exchange, signOut: h.signOut },
  }),
}));
vi.mock('@/lib/auth/invite-set-token', () => ({ signInviteSet: (id: string) => `firmado:${id}` }));

const { GET } = await import('./route');

function call(url: string) {
  return GET(new NextRequest(url), { params: Promise.resolve({ locale: 'es' }) });
}

beforeEach(() => {
  h.exchange.mockReset();
  h.signOut.mockReset().mockResolvedValue({ error: null });
});

describe('GET /auth/callback', () => {
  it('issues the signed cookie, closes the recovery session and goes to /reset-password', async () => {
    h.exchange.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const res = await call('http://localhost/es/auth/callback?code=abc');

    expect(new URL(res.headers.get('location')!).pathname).toBe('/es/reset-password');
    expect(res.cookies.get(INVITE_SET_COOKIE)?.value).toBe('firmado:user-1');
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('sends an invalid or used code back to forgot-password without a cookie', async () => {
    h.exchange.mockResolvedValue({ data: { user: null }, error: { message: 'bad code' } });

    const res = await call('http://localhost/es/auth/callback?code=abc');

    expect(res.headers.get('location')).toContain('/es/forgot-password?error=link-expired');
    expect(res.cookies.get(INVITE_SET_COOKIE)).toBeUndefined();
  });
});
