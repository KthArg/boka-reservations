// Cuenta borrada en Supabase Auth (spec 0038, migración …051): el trigger on_auth_user_deleted
// borra la fila de public.users o, si tiene historial, la deja inactiva con el correo liberado.
// Se borra con auth.admin.deleteUser, el mismo camino que el dashboard de Supabase (GoTrue).
// Requiere: supabase start. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function authAccount(): Promise<{ id: string; email: string }> {
  const email = `borrado-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Prueba2026x',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? 'sin usuario');
  return { id: data.user.id, email };
}

async function staff(): Promise<{ id: string; email: string }> {
  const account = await authAccount();
  const { error } = await admin.from('users').insert({
    id: account.id,
    email: account.email,
    role: 'staff',
    full_name: 'Staff de prueba',
    phone: '+506 8888-8888',
  });
  if (error) throw new Error(error.message);
  return account;
}

async function row(id: string) {
  const { data } = await admin
    .from('users')
    .select('active, email, phone')
    .eq('id', id)
    .maybeSingle();
  return data;
}

describe('cuenta borrada en Supabase Auth (spec 0038)', () => {
  it('sin historial, se borra la fila del panel', async () => {
    const { id } = await staff();

    const { error } = await admin.auth.admin.deleteUser(id);

    expect(error).toBeNull();
    expect(await row(id)).toBeNull();
  });

  it('con historial, la fila queda inactiva y el correo se libera', async () => {
    const { id, email } = await staff();
    const audit = await admin.from('audit_logs').insert({
      actor_type: 'staff',
      actor_id: id,
      action: 'test.auth_user_deleted',
      entity_type: 'test',
      entity_id: crypto.randomUUID(),
    });
    expect(audit.error).toBeNull();

    const { error } = await admin.auth.admin.deleteUser(id);

    expect(error).toBeNull();
    expect(await row(id)).toEqual({
      active: false,
      email: `${id}@cuenta-borrada.invalid`,
      phone: null,
    });
    const { count } = await admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('email', email);
    expect(count).toBe(0);
  });

  it('una cuenta sin fila en el panel se borra sin error', async () => {
    const { id } = await authAccount();

    const { error } = await admin.auth.admin.deleteUser(id);

    expect(error).toBeNull();
  });
});
