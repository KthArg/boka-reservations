// updateBusinessSettings (specs 0029 y 0033): guard de admin, validación de los rangos y escritura con la
// sesión real del usuario, para que la RLS de …043 corra de verdad. Se mockean solo las
// fronteras de Next que no existen en vitest: requireRole (next/headers), el cliente de sesión
// (cookies) —que devuelve un cliente Supabase autenticado real— y next/cache.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUSINESS_SETTINGS_ID, SettingsActionError } from '@shared/constants/settings';
import { updateBusinessSettings } from '@/lib/settings/actions';
import type { Database } from '@/types/database';

const requireRoleMock = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/auth/server', () => ({ requireRole: requireRoleMock }));
vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

type Settings = {
  minimum_decision_window_hours: number;
  default_charge_lead_hours: number;
  updated_by: string | null;
};

const service = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let adminSession: SupabaseClient<Database>;
let staffSession: SupabaseClient<Database>;
let adminId: string;
let staffId: string;
let original: Settings;

async function signIn(email: string, password: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

async function userId(email: string): Promise<string> {
  const { data, error } = await service.from('users').select('id').eq('email', email).single();
  if (error) throw new Error(`userId ${email}: ${error.message}`);
  return data.id;
}

async function currentSettings(): Promise<Settings> {
  const { data, error } = await service
    .from('business_settings')
    .select('minimum_decision_window_hours, default_charge_lead_hours, updated_by')
    .eq('id', BUSINESS_SETTINGS_ID)
    .single();
  if (error) throw new Error(`currentSettings: ${error.message}`);
  return data;
}

function formWith(hours: string, leadHours = '48'): FormData {
  const form = new FormData();
  form.append('minimum_decision_window_hours', hours);
  form.append('default_charge_lead_hours', leadHours);
  return form;
}

beforeAll(async () => {
  [adminSession, staffSession] = await Promise.all([
    signIn('admin@bokatrails.com', 'admin1234'),
    signIn('staff@bokatrails.com', 'staff1234'),
  ]);
  [adminId, staffId] = await Promise.all([
    userId('admin@bokatrails.com'),
    userId('staff@bokatrails.com'),
  ]);
  original = await currentSettings();
});

afterEach(async () => {
  requireRoleMock.mockReset();
  const { error } = await service
    .from('business_settings')
    .update(original)
    .eq('id', BUSINESS_SETTINGS_ID);
  if (error) throw new Error(`restore settings: ${error.message}`);
});

afterAll(async () => {
  // scope local: el signOut por defecto es global y cerraría también las sesiones del
  // navegador de quien corre la suite con el mismo usuario del seed.
  await Promise.all([
    adminSession.auth.signOut({ scope: 'local' }),
    staffSession.auth.signOut({ scope: 'local' }),
  ]);
});

describe('updateBusinessSettings', () => {
  it('saves the decision window and the charge lead time with the admin as their author', async () => {
    // Arrange
    session.client = adminSession;
    requireRoleMock.mockResolvedValue({ id: adminId });

    // Act
    const result = await updateBusinessSettings(null, formWith('48', '24'));

    // Assert
    expect(result).toEqual({ success: true });
    expect(await currentSettings()).toEqual({
      minimum_decision_window_hours: 48,
      default_charge_lead_hours: 24,
      updated_by: adminId,
    });
  });

  it.each(['0', '721', 'abc'])('rejects %j as a charge lead time, without writing', async (raw) => {
    // Arrange
    session.client = adminSession;
    requireRoleMock.mockResolvedValue({ id: adminId });

    // Act
    const result = await updateBusinessSettings(null, formWith('48', raw));

    // Assert
    expect(result).toEqual({ success: false, error: SettingsActionError.LeadHoursOutOfRange });
    expect(await currentSettings()).toEqual(original);
  });

  it('rejects a user who is not an admin, without writing', async () => {
    // Arrange
    session.client = staffSession;
    requireRoleMock.mockRejectedValue(new Error('UNAUTHORIZED'));

    // Act
    const result = await updateBusinessSettings(null, formWith('48'));

    // Assert
    expect(result).toEqual({ success: false, error: SettingsActionError.Unauthorized });
    expect(await currentSettings()).toEqual(original);
  });

  it.each(['0', '721', 'abc'])('rejects %j as a decision window, without writing', async (raw) => {
    // Arrange
    session.client = adminSession;
    requireRoleMock.mockResolvedValue({ id: adminId });

    // Act
    const result = await updateBusinessSettings(null, formWith(raw));

    // Assert
    expect(result).toEqual({ success: false, error: SettingsActionError.WindowOutOfRange });
    expect(await currentSettings()).toEqual(original);
  });

  it('reports a failed update when the database refuses a session without the admin role', async () => {
    // Arrange: el guard de la app pasa, pero el JWT de la sesión es de staff (defensa en capas).
    session.client = staffSession;
    requireRoleMock.mockResolvedValue({ id: staffId });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Act
    const result = await updateBusinessSettings(null, formWith('48'));

    // Assert
    expect(result).toEqual({ success: false, error: SettingsActionError.UpdateFailed });
    expect(await currentSettings()).toEqual(original);
  });
});
