// Acciones del segundo factor (spec 0049 §5.1–§5.2) contra Supabase real: enrolamiento, verificación
// con su límite por usuario y la auditoría, y el reseteo del factor por un admin (borra factores,
// invalida la contraseña, cierra sesiones, manda el correo de acceso y audita). Se mockean solo el
// cliente de sesión (cookies), los redirects y el locale.
// Requiere: supabase start + seed (con TOTP habilitado en config.toml). Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import { RATE_LIMITS, RATE_LIMIT_KEY_PREFIX } from '@shared/constants/rate-limit';
import { UserManagementError } from '@shared/constants/users';
import { rateLimitKey } from '@/lib/security/rate-limit-key';
import { completeSecondFactor, totp } from './mfa-fixtures';

const state = vi.hoisted(() => ({ client: null as unknown, adminId: '' }));

class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}

vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: async () => state.client,
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock('next-intl/server', () => ({ getLocale: () => Promise.resolve('es') }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    env: new Proxy(actual.env, {
      get: (target, key) =>
        key === 'RATE_LIMIT_ENABLED' ? 'true' : (Reflect.get(target, key) as unknown),
    }),
  };
});
// Solo requireRole (para la acción del reseteo); el resto del módulo, real.
vi.mock('@/lib/auth/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/server')>();
  return { ...actual, requireRole: () => Promise.resolve({ id: state.adminId }) };
});

const { startMfaEnrollmentAction, verifyMfaAction } = await import('@/lib/auth/mfa-actions');
const { resetUserMfa } = await import('@/lib/users/mfa');
const { resetMfa } = await import('@/lib/users/actions');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON_KEY || !SERVICE_KEY) throw new Error('Supabase keys missing — load .env.local');

const OPTIONS = { auth: { autoRefreshToken: false, persistSession: false } };
const service = createClient<Database>(SUPABASE_URL, SERVICE_KEY, OPTIONS);
// Un staff propio del archivo: el reseteo le cambia la contraseña y la API de admin no deja
// restaurar la del seed (`staff1234` no cumple la política), así que no se toca al del seed.
const STAFF = {
  email: `mfa-reset-${crypto.randomUUID().slice(0, 8)}@example.com`,
  password: 'Prueba-Mfa-2026',
};
const ADMIN = { email: 'admin@bokatrails.com', password: 'admin1234' };

async function signIn(who: { email: string; password: string }): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY!, OPTIONS);
  const { error } = await client.auth.signInWithPassword(who);
  if (error) throw new Error(`signIn ${who.email}: ${error.message}`);
  return client;
}

async function userIdOf(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getUser();
  return data.user!.id;
}

async function clearFactors(userId: string): Promise<void> {
  const { data } = await service.auth.admin.mfa.listFactors({ userId });
  for (const f of data?.factors ?? [])
    await service.auth.admin.mfa.deleteFactor({ id: f.id, userId });
}

async function clearMfaRateLimit(userId: string): Promise<void> {
  await service
    .from('rate_limits')
    .delete()
    .eq('key', rateLimitKey(RATE_LIMIT_KEY_PREFIX.mfaVerifyUser, userId));
}

function codeForm(factorId: string, code: string): FormData {
  const form = new FormData();
  form.set('factorId', factorId);
  form.set('code', code);
  form.set('redirectTo', '/es/dashboard/bookings');
  return form;
}

async function verify(factorId: string, code: string) {
  try {
    return { state: await verifyMfaAction(null, codeForm(factorId, code)), redirectedTo: null };
  } catch (err) {
    if (err instanceof RedirectSignal) return { state: null, redirectedTo: err.to };
    throw err;
  }
}

let staffId: string;

beforeAll(async () => {
  const { data, error } = await service.auth.admin.createUser({
    email: STAFF.email,
    password: STAFF.password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  const { error: rowError } = await service.from('users').insert({
    id: data.user.id,
    email: STAFF.email,
    role: 'staff',
    full_name: 'Staff MFA',
  });
  if (rowError) throw new Error(`users row: ${rowError.message}`);
});

beforeEach(async () => {
  state.client = await signIn(STAFF);
  staffId = await userIdOf(state.client as SupabaseClient);
  await clearFactors(staffId);
  await clearMfaRateLimit(staffId);
});

afterAll(async () => {
  await clearMfaRateLimit(staffId);
  await service.from('users').delete().eq('id', staffId);
  await service.auth.admin.deleteUser(staffId);
});

describe('startMfaEnrollmentAction', () => {
  it('returns a QR and a key, and replaces an unverified factor from a previous attempt', async () => {
    // Act
    const first = await startMfaEnrollmentAction();
    const second = await startMfaEnrollmentAction();

    // Assert
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.qrCode).toMatch(/^data:image\/svg\+xml/);
    const { data } = await service.auth.admin.mfa.listFactors({ userId: staffId });
    expect(data!.factors.map((f) => f.id)).toEqual([second.factorId]);
  });
});

describe('verifyMfaAction', () => {
  it('verifies the first code, audits the enrollment and redirects to the requested page', async () => {
    // Arrange
    const enrollment = await startMfaEnrollmentAction();
    if (!enrollment.ok) throw new Error(enrollment.error);

    // Act
    const result = await verify(enrollment.factorId, totp(enrollment.secret));

    // Assert
    expect(result.redirectedTo).toBe('/es/dashboard/bookings');
    const { data: session } = await (state.client as SupabaseClient).auth.getSession();
    const claims = JSON.parse(
      Buffer.from(session.session!.access_token.split('.')[1]!, 'base64url').toString(),
    ) as { aal: string };
    expect(claims.aal).toBe('aal2');
    const { data: audit } = await service
      .from('audit_logs')
      .select('id')
      .eq('action', 'user.mfa_enrolled')
      .eq('entity_id', staffId);
    expect(audit!.length).toBeGreaterThan(0);
  });

  it('rejects a wrong code, and stops after the per-user limit', async () => {
    // Arrange
    const enrollment = await startMfaEnrollmentAction();
    if (!enrollment.ok) throw new Error(enrollment.error);

    // Act
    const results = [];
    for (let i = 0; i <= RATE_LIMITS.mfaVerifyPerUser.limit; i += 1) {
      results.push((await verify(enrollment.factorId, '000000')).state);
    }

    // Assert
    expect(results[0]).toEqual({ error: 'invalid-code' });
    expect(results.at(-1)).toEqual({ error: 'too-many-attempts' });
  });

  it('does not accept a factor of another user', async () => {
    const result = await verify(crypto.randomUUID(), '123456');
    expect(result.state).toEqual({ error: 'session-expired' });
  });
});

describe('resetUserMfa', () => {
  /** La acción corre con la sesión aal2 del admin que resetea: es la que lee `users` por RLS. */
  async function adminPanelSession(): Promise<string> {
    const admin = await signIn(ADMIN);
    await completeSecondFactor(admin);
    state.client = admin;
    return userIdOf(admin);
  }

  it('deletes the factors, invalidates the password and the sessions, and audits', async () => {
    // Arrange: el staff con su factor y una sesión abierta.
    const staff = state.client as SupabaseClient;
    await completeSecondFactor(staff);
    const { data: before } = await staff.auth.getSession();
    const adminId = await adminPanelSession();

    // Act
    const result = await resetUserMfa(staffId, adminId, 'es');

    // Assert
    expect(result).toEqual({ ok: true, sent: 'password' });
    const { data: factors } = await service.auth.admin.mfa.listFactors({ userId: staffId });
    expect(factors!.factors).toEqual([]);
    const oldPassword = await createClient(SUPABASE_URL, ANON_KEY, OPTIONS).auth.signInWithPassword(
      STAFF,
    );
    expect(oldPassword.error).not.toBeNull();
    const refresh = await createClient(SUPABASE_URL, ANON_KEY, OPTIONS).auth.refreshSession({
      refresh_token: before.session!.refresh_token,
    });
    expect(refresh.error).not.toBeNull();
    const { data: audit } = await service
      .from('audit_logs')
      .select('actor_id')
      .eq('action', 'user.mfa_reset')
      .eq('entity_id', staffId)
      .order('created_at', { ascending: false })
      .limit(1);
    expect(audit).toEqual([{ actor_id: adminId }]);

    // Restaurar para los casos siguientes de este archivo.
    await service.auth.admin.updateUserById(staffId, { password: STAFF.password });
  });

  it('is idempotent: a second reset with no factors left still works', async () => {
    const adminId = await adminPanelSession();
    const result = await resetUserMfa(staffId, adminId, 'es');
    expect(result.ok).toBe(true);
    await service.auth.admin.updateUserById(staffId, { password: STAFF.password });
  });
});

describe('resetMfa (acción del panel)', () => {
  it('does not let an admin reset their own second factor', async () => {
    state.adminId = staffId;
    expect(await resetMfa(staffId)).toEqual({ ok: false, error: UserManagementError.SelfMfaReset });
  });
});
