import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { UserManagementError } from '@shared/constants/users';

// Mockeamos las fronteras del runtime de Next (auth, cache, locale, navigation) y
// el server client (next/headers). La escritura corre de verdad contra Postgres y
// la creación de cuentas de auth contra el GoTrue local (Admin API + Mailpit).
vi.mock('server-only', () => ({}));
const requireRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/server', () => ({ requireRole: requireRoleMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'es') }));
vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }),
}));

const { createUser, updateUser, setActive } = await import('@/lib/users/actions');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let admin: SupabaseClient;
let adminUserId: string;
let adminEmail: string;
const createdUserIds: string[] = [];

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

async function findUserByEmail(email: string): Promise<{ id: string; role: string } | null> {
  const { data } = await admin.from('users').select('id, role').eq('email', email).maybeSingle();
  if (data) createdUserIds.push(data.id);
  return data;
}

describe('user management server actions (integration)', () => {
  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: seedAdmin } = await admin
      .from('users')
      .select('id, email')
      .eq('role', 'admin')
      .eq('active', true)
      .limit(1)
      .single();
    adminUserId = seedAdmin!.id;
    adminEmail = seedAdmin!.email;
  });

  afterEach(async () => {
    requireRoleMock.mockReset();
    while (createdUserIds.length) {
      const id = createdUserIds.pop()!;
      await admin.auth.admin.deleteUser(id).catch(() => undefined);
      await admin.from('users').delete().eq('id', id);
    }
  });

  it('creates a guide as public.users only, without an auth account', async () => {
    requireRoleMock.mockResolvedValue({ id: adminUserId });
    const email = `u-guide-${crypto.randomUUID()}@example.com`;

    await createUser(
      null,
      form({ email, full_name: 'Guía Test', role: 'guide', phone: '+506 8000-1111', locale: 'es' }),
    );

    const row = await findUserByEmail(email);
    expect(row).not.toBeNull();
    expect(row!.role).toBe('guide');
    const { data: authResult } = await admin.auth.admin.getUserById(row!.id);
    expect(authResult.user).toBeNull();
  });

  it('creates a staff member with an auth account sharing the same id', async () => {
    requireRoleMock.mockResolvedValue({ id: adminUserId });
    const email = `u-staff-${crypto.randomUUID()}@example.com`;

    await createUser(null, form({ email, full_name: 'Staff Test', role: 'staff', locale: 'es' }));

    const row = await findUserByEmail(email);
    expect(row).not.toBeNull();
    const { data: authResult } = await admin.auth.admin.getUserById(row!.id);
    expect(authResult.user?.id).toBe(row!.id);
    expect(authResult.user?.email).toBe(email);
  });

  it('rejects a duplicate email', async () => {
    requireRoleMock.mockResolvedValue({ id: adminUserId });

    const result = await createUser(
      null,
      form({ email: adminEmail, full_name: 'Otro', role: 'staff', locale: 'es' }),
    );

    expect(result).toEqual({ success: false, errors: { email: [UserManagementError.EmailTaken] } });
  });

  it('rejects creation by a non-admin', async () => {
    requireRoleMock.mockRejectedValue(new Error('UNAUTHORIZED'));
    const email = `u-x-${crypto.randomUUID()}@example.com`;

    const result = await createUser(
      null,
      form({ email, full_name: 'X', role: 'staff', locale: 'es' }),
    );

    expect(result).toEqual({
      success: false,
      errors: { _form: [UserManagementError.Unauthorized] },
    });
    expect(await findUserByEmail(email)).toBeNull();
  });

  it('rejects a guide without phone (Zod refine)', async () => {
    requireRoleMock.mockResolvedValue({ id: adminUserId });
    const email = `u-nophone-${crypto.randomUUID()}@example.com`;

    const result = await createUser(
      null,
      form({ email, full_name: 'Sin Tel', role: 'guide', phone: '', locale: 'es' }),
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.phone).toContain('phone-required-for-guide');
    expect(await findUserByEmail(email)).toBeNull();
  });

  it('updates the editable fields of a user', async () => {
    requireRoleMock.mockResolvedValue({ id: adminUserId });
    const email = `u-upd-${crypto.randomUUID()}@example.com`;
    await createUser(
      null,
      form({ email, full_name: 'Antes', role: 'guide', phone: '+506 1111-1111', locale: 'es' }),
    );
    const row = await findUserByEmail(email);

    await updateUser(
      row!.id,
      null,
      form({ full_name: 'Después', phone: '+506 2222-2222', locale: 'en' }),
    );

    const { data: updated } = await admin
      .from('users')
      .select('full_name, phone, locale')
      .eq('id', row!.id)
      .single();
    expect(updated).toEqual({ full_name: 'Después', phone: '+506 2222-2222', locale: 'en' });
  });

  it('deactivates and reactivates a guide', async () => {
    requireRoleMock.mockResolvedValue({ id: adminUserId });
    const email = `u-toggle-${crypto.randomUUID()}@example.com`;
    await createUser(
      null,
      form({ email, full_name: 'Toggle', role: 'guide', phone: '+506 3333-3333', locale: 'es' }),
    );
    const row = await findUserByEmail(email);

    expect(await setActive(row!.id, false)).toEqual({ ok: true });
    const { data: off } = await admin.from('users').select('active').eq('id', row!.id).single();
    expect(off!.active).toBe(false);

    expect(await setActive(row!.id, true)).toEqual({ ok: true });
    const { data: on } = await admin.from('users').select('active').eq('id', row!.id).single();
    expect(on!.active).toBe(true);
  });

  it('blocks an admin from deactivating themselves', async () => {
    requireRoleMock.mockResolvedValue({ id: adminUserId });

    const result = await setActive(adminUserId, false);

    expect(result).toEqual({ ok: false, error: UserManagementError.SelfDeactivation });
    const { data: stillActive } = await admin
      .from('users')
      .select('active')
      .eq('id', adminUserId)
      .single();
    expect(stillActive!.active).toBe(true);
  });
});
