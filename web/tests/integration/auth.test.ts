// Requiere: supabase start (Docker Desktop) — hook registrado vía config.toml
// Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll } from 'vitest';
import type { Database } from '@/types/database';

// Fallbacks = default local JWT secret (supabase start con config.toml estándar)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

// --- login / logout ---

describe('auth — login y logout', () => {
  it('login correcto crea sesión', async () => {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY);
    const { data, error } = await client.auth.signInWithPassword({
      email: 'admin@bokatrails.com',
      password: 'admin1234',
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
    expect(data.user?.email).toBe('admin@bokatrails.com');
    await client.auth.signOut();
  });

  it('login con contraseña incorrecta retorna error', async () => {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY);
    const { data, error } = await client.auth.signInWithPassword({
      email: 'admin@bokatrails.com',
      password: 'wrong-password',
    });
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });

  it('logout destruye la sesión', async () => {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY);
    await client.auth.signInWithPassword({
      email: 'staff@bokatrails.com',
      password: 'staff1234',
    });
    await client.auth.signOut();
    const { data } = await client.auth.getUser();
    expect(data.user).toBeNull();
  });
});

// --- usuario desactivado ---

describe('auth — usuario desactivado', () => {
  const INACTIVE_EMAIL = 'inactive@bokatrails.com';
  let inactiveUserId: string;

  beforeAll(async () => {
    const { data } = await admin.auth.admin.createUser({
      email: INACTIVE_EMAIL,
      password: 'inactive123',
      email_confirm: true,
    });
    inactiveUserId = data.user!.id;
    await admin
      .from('users')
      .insert({
        id: inactiveUserId,
        email: INACTIVE_EMAIL,
        role: 'staff',
        full_name: 'Inactivo Test',
        active: false,
      });
  });

  it('puede obtener sesión aunque active=false (el guard se aplica en requireAuth)', async () => {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY);
    const { error } = await client.auth.signInWithPassword({
      email: INACTIVE_EMAIL,
      password: 'inactive123',
    });
    expect(error).toBeNull();
    await client.auth.signOut();
    await admin.from('users').delete().eq('id', inactiveUserId);
    await admin.auth.admin.deleteUser(inactiveUserId);
  });
});

// --- RLS con sesión autenticada ---

describe('RLS — con sesión autenticada', () => {
  it('staff autenticado no puede hacer UPDATE en tours', async () => {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY);
    await client.auth.signInWithPassword({
      email: 'staff@bokatrails.com',
      password: 'staff1234',
    });

    // RLS filter policy: UPDATE afecta 0 filas sin retornar error explícito
    await client
      .from('tours')
      .update({ name_es: 'Modificado por staff' })
      .eq('slug', 'cerro-chompipe');

    const { data } = await admin
      .from('tours')
      .select('name_es')
      .eq('slug', 'cerro-chompipe')
      .single();

    expect(data?.name_es).not.toBe('Modificado por staff');
    await client.auth.signOut();
  });

  it('staff autenticado puede leer tours', async () => {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY);
    await client.auth.signInWithPassword({
      email: 'staff@bokatrails.com',
      password: 'staff1234',
    });

    const { data, error } = await client.from('tours').select('slug');
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    await client.auth.signOut();
  });
});

// --- JWT claim user_role (requiere hook registrado) ---

describe('JWT — claim user_role', () => {
  it('admin tiene user_role=admin en el JWT', async () => {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY);
    const { data } = await client.auth.signInWithPassword({
      email: 'admin@bokatrails.com',
      password: 'admin1234',
    });

    const token = data.session?.access_token;
    expect(token).toBeDefined();

    const payload = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString());
    expect(payload.user_role).toBe('admin');
    await client.auth.signOut();
  });

  it('guide tiene user_role=guide en el JWT', async () => {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY);
    const { data } = await client.auth.signInWithPassword({
      email: 'carlos@bokatrails.com',
      password: 'guide1234',
    });

    const token = data.session?.access_token;
    expect(token).toBeDefined();

    const payload = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString());
    expect(payload.user_role).toBe('guide');
    await client.auth.signOut();
  });
});
