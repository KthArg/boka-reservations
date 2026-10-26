import { beforeEach, describe, expect, it, vi } from 'vitest';

// requireAuth (spec 0049 §5.1): una sesión del panel sin el segundo factor falla con MFA_REQUIRED
// ANTES de leer `users` (con la RLS de …064 esa lectura vendría vacía y caería como cuenta
// inactiva). Supabase simulado: sin red ni DB.
const h = vi.hoisted(() => ({ claims: {} as Record<string, unknown>, from: vi.fn() }));

vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      getSession: async () => ({
        data: {
          session: {
            access_token: `h.${Buffer.from(JSON.stringify(h.claims)).toString('base64url')}.s`,
          },
        },
      }),
    },
    from: h.from,
  }),
}));

const { AuthError, requireAuth, requirePanelSessionForMfa } = await import('./server');

function usersReturning(row: unknown) {
  h.from.mockReturnValue({
    select: () => ({ eq: () => ({ single: async () => ({ data: row }) }) }),
  });
}

beforeEach(() => {
  h.from.mockReset();
});

describe('requireAuth — segundo factor', () => {
  it.each(['admin', 'staff'])(
    'fails with MFA_REQUIRED for a %s session without aal2, without reading users',
    async (role) => {
      h.claims = { user_role: role, aal: 'aal1' };
      await expect(requireAuth()).rejects.toMatchObject({ code: 'MFA_REQUIRED' });
      expect(h.from).not.toHaveBeenCalled();
    },
  );

  it('passes an aal2 session of an active user', async () => {
    h.claims = { user_role: 'staff', aal: 'aal2' };
    usersReturning({ active: true });
    await expect(requireAuth()).resolves.toMatchObject({ userRole: 'staff', aal: 'aal2' });
  });

  it('keeps failing as inactive for an aal2 session of a deactivated user', async () => {
    h.claims = { user_role: 'staff', aal: 'aal2' };
    usersReturning({ active: false });
    const failure = await requireAuth().catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(AuthError);
    expect(failure).toMatchObject({ code: 'ACCOUNT_INACTIVE' });
  });
});

describe('requirePanelSessionForMfa', () => {
  it('accepts an aal1 panel session without reading tables', async () => {
    h.claims = { user_role: 'admin', aal: 'aal1' };
    await expect(requirePanelSessionForMfa()).resolves.toMatchObject({ userRole: 'admin' });
    expect(h.from).not.toHaveBeenCalled();
  });

  it('rejects a session that is not of the panel', async () => {
    h.claims = { user_role: 'guide', aal: 'aal1' };
    await expect(requirePanelSessionForMfa()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
