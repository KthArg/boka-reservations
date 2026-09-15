// business_settings (spec 0029, migración …043): fila única, rango de la ventana de decisión,
// RLS por rol y grants por columna. Las denegaciones usan sesiones reales (service_role
// bypassa grants y RLS); la de anon está en table-grants.test.ts.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUSINESS_SETTINGS_ID } from '@shared/constants/settings';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const CHECK_VIOLATION = '23514';
const PERMISSION_DENIED = '42501';

type Settings = { minimum_decision_window_hours: number; updated_by: string | null };

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
    .select('minimum_decision_window_hours, updated_by')
    .eq('id', BUSINESS_SETTINGS_ID)
    .single();
  if (error) throw new Error(`currentSettings: ${error.message}`);
  return data;
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

afterAll(async () => {
  const { error } = await service
    .from('business_settings')
    .update(original)
    .eq('id', BUSINESS_SETTINGS_ID);
  // scope local: el signOut por defecto es global y cerraría también las sesiones del
  // navegador de quien corre la suite con el mismo usuario del seed.
  await Promise.all([
    adminSession.auth.signOut({ scope: 'local' }),
    staffSession.auth.signOut({ scope: 'local' }),
  ]);
  if (error) throw new Error(`restore settings: ${error.message}`);
});

describe('business_settings — fila única', () => {
  it('has exactly one row', async () => {
    // Act
    const { data, error } = await service.from('business_settings').select('id');

    // Assert
    expect(error).toBeNull();
    expect(data).toEqual([{ id: BUSINESS_SETTINGS_ID }]);
  });

  it('rejects a second row', async () => {
    // Act
    const { error } = await service.from('business_settings').insert({ id: 2 });

    // Assert
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain('business_settings_singleton_check');
  });

  it.each([0, 721])('rejects a decision window of %i hours', async (hours) => {
    // Act
    const { error } = await service
      .from('business_settings')
      .update({ minimum_decision_window_hours: hours })
      .eq('id', BUSINESS_SETTINGS_ID);

    // Assert
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain('business_settings_decision_window_check');
  });
});

describe('business_settings — RLS y grants por columna', () => {
  it('lets an admin change the window and records them as the author', async () => {
    // Act
    const { data, error } = await adminSession
      .from('business_settings')
      .update({ minimum_decision_window_hours: 36, updated_by: adminId })
      .eq('id', BUSINESS_SETTINGS_ID)
      .select('minimum_decision_window_hours, updated_by');

    // Assert
    expect(error).toBeNull();
    expect(data).toEqual([{ minimum_decision_window_hours: 36, updated_by: adminId }]);
  });

  it('rejects an admin recording someone else as the author, without writing', async () => {
    // Arrange
    const before = await currentSettings();

    // Act
    const { error } = await adminSession
      .from('business_settings')
      .update({ minimum_decision_window_hours: 30, updated_by: staffId })
      .eq('id', BUSINESS_SETTINGS_ID);

    // Assert
    expect(error?.code).toBe(PERMISSION_DENIED);
    expect(await currentSettings()).toEqual(before);
  });

  it('lets staff read the settings but not change them', async () => {
    // Arrange
    const before = await currentSettings();

    // Act
    const read = await staffSession.from('business_settings').select('id');
    const write = await staffSession
      .from('business_settings')
      .update({ minimum_decision_window_hours: 99, updated_by: staffId })
      .eq('id', BUSINESS_SETTINGS_ID)
      .select('id');

    // Assert
    expect(read.data).toEqual([{ id: BUSINESS_SETTINGS_ID }]);
    expect(write.data).toEqual([]);
    expect(await currentSettings()).toEqual(before);
  });

  it.each([
    ['id', { id: 2 }],
    ['updated_at', { updated_at: new Date(0).toISOString() }],
  ])('rejects an admin updating the %s column', async (_column, change) => {
    // Act
    const { error } = await adminSession
      .from('business_settings')
      .update(change)
      .eq('id', BUSINESS_SETTINGS_ID);

    // Assert
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('rejects an authenticated insert', async () => {
    // Act
    const { error } = await adminSession.from('business_settings').insert({ id: 1 });

    // Assert
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('rejects an authenticated delete', async () => {
    // Act
    const { error } = await adminSession
      .from('business_settings')
      .delete()
      .eq('id', BUSINESS_SETTINGS_ID);

    // Assert
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { data } = await service.from('business_settings').select('id');
    expect(data).toEqual([{ id: BUSINESS_SETTINGS_ID }]);
  });
});
