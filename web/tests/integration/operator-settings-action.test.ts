// updateOperatorSettings (spec 0034): solo admin, validación y auditoría con los valores
// anteriores y nuevos. Escribe con la sesión real del usuario para que la RLS corra de verdad; se
// mockean solo las fronteras de Next (requireRole, el cliente de sesión y next/cache), como en
// settings-action.test.ts.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditAction, BUSINESS_SETTINGS_AUDIT_ENTITY_ID } from '@shared/constants/audit';
import { BUSINESS_SETTINGS_ID, SettingsActionError } from '@shared/constants/settings';
import { updateOperatorSettings } from '@/lib/settings/operator-actions';
import { OPERATOR_TEXT_FIELDS } from '@/lib/settings/operator-types';
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

const COLUMNS = [
  ...OPERATOR_TEXT_FIELDS,
  'operator_has_liability_policy',
  'no_show_tolerance_minutes',
].join(', ');

type OperatorRow = Record<string, string | number | boolean>;
type SettingsUpdate = Database['public']['Tables']['business_settings']['Update'];

const service = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let adminSession: SupabaseClient<Database>;
let staffSession: SupabaseClient<Database>;
let adminId: string;
let original: OperatorRow;
const startedAt = new Date().toISOString();

async function signIn(email: string, password: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

async function current(): Promise<OperatorRow> {
  const { data, error } = await service
    .from('business_settings')
    .select(COLUMNS)
    .eq('id', BUSINESS_SETTINGS_ID)
    .single();
  if (error) throw new Error(`current: ${error.message}`);
  return data as unknown as OperatorRow;
}

function formWith(overrides: Record<string, string> = {}): FormData {
  const values: Record<string, string> = {
    operator_legal_name: 'Aventuras del Norte S.A.',
    operator_tax_id: '3-101-654321',
    operator_address: 'Liberia, Guanacaste',
    operator_brand: 'Aventuras del Norte',
    operator_contact_email: 'hola@aventuras.cr',
    operator_privacy_email: 'privacidad@aventuras.cr',
    operator_phone: '+506 2666-0000',
    operator_hours: 'Lunes a viernes, 8:00 a 17:00',
    operator_ict_declaration: 'ICT-1234',
    operator_has_liability_policy: 'on',
    no_show_tolerance_minutes: '20',
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.append(key, value);
  return form;
}

beforeAll(async () => {
  [adminSession, staffSession] = await Promise.all([
    signIn('admin@bokatrails.com', 'admin1234'),
    signIn('staff@bokatrails.com', 'staff1234'),
  ]);
  const { data } = await service
    .from('users')
    .select('id')
    .eq('email', 'admin@bokatrails.com')
    .single();
  adminId = data!.id;
  original = await current();
});

afterEach(async () => {
  requireRoleMock.mockReset();
  const { error } = await service
    .from('business_settings')
    .update(original as SettingsUpdate)
    .eq('id', BUSINESS_SETTINGS_ID);
  if (error) throw new Error(`restore: ${error.message}`);
});

afterAll(async () => {
  await Promise.all([
    adminSession.auth.signOut({ scope: 'local' }),
    staffSession.auth.signOut({ scope: 'local' }),
  ]);
});

describe('updateOperatorSettings', () => {
  it('guarda la identidad y deja en la auditoría los valores anteriores y nuevos', async () => {
    // Arrange
    session.client = adminSession;
    requireRoleMock.mockResolvedValue({ id: adminId });

    // Act
    const result = await updateOperatorSettings(null, formWith());

    // Assert
    expect(result).toEqual({ success: true });
    const saved = await current();
    expect(saved.operator_legal_name).toBe('Aventuras del Norte S.A.');
    expect(saved.no_show_tolerance_minutes).toBe(20);

    const { data: logs } = await service
      .from('audit_logs')
      .select('actor_id, metadata')
      .eq('action', AuditAction.OperatorSettingsUpdated)
      .eq('entity_id', BUSINESS_SETTINGS_AUDIT_ENTITY_ID)
      .gte('created_at', startedAt)
      .order('created_at', { ascending: false })
      .limit(1);
    const log = logs![0]!;
    const metadata = log.metadata as { before: OperatorRow; after: OperatorRow };
    expect(log.actor_id).toBe(adminId);
    expect(metadata.before.operator_legal_name).toBe(original.operator_legal_name);
    expect(metadata.after.operator_legal_name).toBe('Aventuras del Norte S.A.');
  });

  it('rechaza a quien no es admin, sin escribir', async () => {
    // Arrange
    session.client = staffSession;
    requireRoleMock.mockRejectedValue(new Error('UNAUTHORIZED'));

    // Act
    const result = await updateOperatorSettings(null, formWith());

    // Assert
    expect(result).toEqual({ success: false, error: SettingsActionError.Unauthorized });
    expect(await current()).toEqual(original);
  });

  it('rechaza un correo inválido, sin escribir', async () => {
    // Arrange
    session.client = adminSession;
    requireRoleMock.mockResolvedValue({ id: adminId });

    // Act
    const result = await updateOperatorSettings(
      null,
      formWith({ operator_contact_email: 'no-es-un-correo' }),
    );

    // Assert
    expect(result).toEqual({ success: false, error: SettingsActionError.OperatorInvalid });
    expect(await current()).toEqual(original);
  });

  it.each(['-1', '121', 'abc'])('rechaza %j como tolerancia, sin escribir', async (raw) => {
    // Arrange
    session.client = adminSession;
    requireRoleMock.mockResolvedValue({ id: adminId });

    // Act
    const result = await updateOperatorSettings(null, formWith({ no_show_tolerance_minutes: raw }));

    // Assert
    expect(result).toEqual({ success: false, error: SettingsActionError.ToleranceOutOfRange });
    expect(await current()).toEqual(original);
  });

  it('informa el fallo cuando la base rechaza una sesión sin rol admin', async () => {
    // Arrange: el guard de la app pasa, pero el JWT es de staff (defensa en capas).
    session.client = staffSession;
    requireRoleMock.mockResolvedValue({ id: adminId });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Act
    const result = await updateOperatorSettings(null, formWith());

    // Assert
    expect(result).toEqual({ success: false, error: SettingsActionError.UpdateFailed });
    expect(await current()).toEqual(original);
  });
});
