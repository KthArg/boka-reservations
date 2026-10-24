import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fijar la contraseña (spec 0049): solo con la cookie firmada de /auth/confirm o /auth/callback.
// Una sesión cualquiera (p. ej. abierta con una contraseña robada, sin segundo factor) no alcanza.
const h = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  updateUserById: vi.fn(),
  deleted: [] as string[],
}));

class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'es' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (h.cookie === undefined ? undefined : { value: h.cookie }),
    delete: (name: string) => h.deleted.push(name),
  }),
}));
vi.mock('@/lib/auth/invite-set-token', () => ({
  verifyInviteSet: (value: string | undefined) => (value === 'firmada' ? 'user-1' : null),
}));
vi.mock('@/lib/db/supabase-service', () => ({
  createSupabaseServiceClient: () => ({ auth: { admin: { updateUserById: h.updateUserById } } }),
}));

const { updatePassword } = await import('./actions');

const STRONG = 'Clave-Nueva-2026';

async function redirectOf(password: string): Promise<string> {
  const form = new FormData();
  form.set('password', password);
  try {
    await updatePassword(form);
  } catch (err) {
    if (err instanceof RedirectSignal) return err.to;
    throw err;
  }
  throw new Error('updatePassword did not redirect');
}

beforeEach(() => {
  h.cookie = undefined;
  h.deleted = [];
  h.updateUserById.mockReset().mockResolvedValue({ error: null });
});

describe('updatePassword', () => {
  it('sets the password of the verified user with the signed cookie and sends to the login', async () => {
    h.cookie = 'firmada';
    expect(await redirectOf(STRONG)).toBe('/es/login?reset=success');
    expect(h.updateUserById).toHaveBeenCalledWith('user-1', { password: STRONG });
    expect(h.deleted.length).toBe(1);
  });

  it('changes nothing without the signed cookie, even with an open session', async () => {
    expect(await redirectOf(STRONG)).toBe('/es/forgot-password?error=link-expired');
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it('changes nothing with a forged cookie', async () => {
    h.cookie = 'inventada';
    expect(await redirectOf(STRONG)).toBe('/es/forgot-password?error=link-expired');
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it('rejects a weak password before touching anything', async () => {
    h.cookie = 'firmada';
    expect(await redirectOf('corta')).toBe('/es/reset-password?error=invalid-password');
    expect(h.updateUserById).not.toHaveBeenCalled();
  });
});
