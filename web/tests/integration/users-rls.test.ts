// RLS de lectura de users (spec 0016, B-4). Verifica con sesiones AUTENTICADAS reales
// (no service_role, que ignora RLS) que: staff ve su propia fila + los guías pero NO la
// PII de otros admin/staff; admin ve todo. Requiere: supabase start + seed.
// Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const ADMIN_EMAIL = 'admin@bokatrails.com';
const STAFF_EMAIL = 'staff@bokatrails.com';

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
let staffSession: SupabaseClient<Database>;
let adminSession: SupabaseClient<Database>;
let staffId: string;
let guideId: string;

async function signIn(email: string, password: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

beforeAll(async () => {
  staffSession = await signIn(STAFF_EMAIL, 'staff1234');
  adminSession = await signIn(ADMIN_EMAIL, 'admin1234');

  const { data: staff } = await admin.from('users').select('id').eq('email', STAFF_EMAIL).single();
  staffId = staff!.id;

  const { data: guide } = await admin
    .from('users')
    .insert({
      email: `guide-rls-${crypto.randomUUID().slice(0, 8)}@example.com`,
      role: 'guide',
      full_name: 'Guía RLS',
      phone: '+506 8000-0001',
    })
    .select('id')
    .single();
  guideId = guide!.id;
});

afterAll(async () => {
  await admin.from('users').delete().eq('id', guideId);
});

describe('RLS de users — lectura restringida (spec 0016, B-4)', () => {
  it('staff ve su propia fila', async () => {
    const { data } = await staffSession.from('users').select('id').eq('id', staffId);
    expect(data).toHaveLength(1);
  });

  it('staff ve las filas de guías (necesario para el panel de salidas)', async () => {
    const { data } = await staffSession.from('users').select('id').eq('id', guideId);
    expect(data).toHaveLength(1);
  });

  it('staff NO puede leer la fila de un admin (PII ajena)', async () => {
    const { data } = await staffSession.from('users').select('id').eq('email', ADMIN_EMAIL);
    expect(data ?? []).toHaveLength(0);
  });

  it('staff no enumera más que su fila + guías al leer todo', async () => {
    const { data } = await staffSession.from('users').select('id, role');
    const nonGuideOther = (data ?? []).filter((u) => u.role !== 'guide' && u.id !== staffId);
    expect(nonGuideOther).toHaveLength(0);
  });

  it('admin sí ve la fila de otro admin y la de staff', async () => {
    const { data: adminRow } = await adminSession
      .from('users')
      .select('id')
      .eq('email', ADMIN_EMAIL);
    const { data: staffRow } = await adminSession.from('users').select('id').eq('id', staffId);
    expect(adminRow).toHaveLength(1);
    expect(staffRow).toHaveLength(1);
  });
});
