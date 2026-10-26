import { beforeEach, describe, expect, it, vi } from 'vitest';

// Login (spec 0049 §5.1): con la contraseña correcta, siempre por /mfa, tenga o no la cuenta un
// factor configurado (el login no revela cuáles lo tienen). Supabase y el throttle simulados.
const h = vi.hoisted(() => ({ signInError: null as unknown }));

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
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'es' }));
vi.mock('@/lib/security/rate-limit', () => ({ checkRateLimit: async () => ({ ok: true }) }));
vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword: async () => ({ error: h.signInError }) },
  }),
}));

const { signIn } = await import('./actions');

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

async function redirectOf(values: Record<string, string>): Promise<string> {
  try {
    await signIn(form(values));
  } catch (err) {
    if (err instanceof RedirectSignal) return err.to;
    throw err;
  }
  throw new Error('signIn did not redirect');
}

const CREDENTIALS = { email: 'a@example.com', password: 'x' };
const mfaTo = (path: string) => `/es/mfa?redirectTo=${encodeURIComponent(path)}`;

beforeEach(() => {
  h.signInError = null;
});

describe('signIn — segundo factor', () => {
  it('goes to /mfa with the dashboard as destination after a correct password', async () => {
    expect(await redirectOf(CREDENTIALS)).toBe(mfaTo('/es/dashboard'));
  });

  it('keeps a safe redirectTo and drops an external one', async () => {
    const kept = await redirectOf({ ...CREDENTIALS, redirectTo: '/es/dashboard/users' });
    const dropped = await redirectOf({ ...CREDENTIALS, redirectTo: '//evil.com' });
    expect(kept).toBe(mfaTo('/es/dashboard/users'));
    expect(dropped).toBe(mfaTo('/es/dashboard'));
  });

  it('stays on the login with the generic error when the password is wrong', async () => {
    h.signInError = { message: 'Invalid login credentials' };
    expect(await redirectOf(CREDENTIALS)).toBe('/es/login?error=invalid-credentials');
  });
});
