// Segundo factor obligatorio en la base (spec 0049 §5.1, §6; migración …064): una sesión de admin
// o staff sin el segundo factor (aal1) no lee ni escribe las tablas del panel ni Storage, aunque
// tenga un token válido. Más los supuestos de GoTrue en los que se apoya la defensa.
// Requiere: supabase start + seed (con TOTP habilitado en config.toml). Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import { completeSecondFactor } from './mfa-fixtures';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON_KEY || !SERVICE_KEY) throw new Error('Supabase keys missing — load .env.local');

const OPTIONS = { auth: { autoRefreshToken: false, persistSession: false } };
const service = createClient<Database>(SUPABASE_URL, SERVICE_KEY, OPTIONS);
const STAFF = { email: 'staff@bokatrails.com', password: 'staff1234' };
const ADMIN = { email: 'admin@bokatrails.com', password: 'admin1234' };
const TOUR_IMAGES_BUCKET = 'tour-images';
const PERMISSION_DENIED = '42501';
// PNG de 1×1: el bucket solo acepta imágenes.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const PANEL_TABLES = [
  'users',
  'tours',
  'tour_pricing',
  'tour_schedules',
  'tour_instances',
  'bookings',
  'payments',
  'notifications',
  'refunds',
  'audit_logs',
  'business_settings',
  'tour_instance_guides',
] as const;

async function signIn(who: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY!, OPTIONS);
  const { error } = await client.auth.signInWithPassword(who);
  if (error) throw new Error(`signIn ${who.email}: ${error.message}`);
  return client;
}

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

let staffAal2: SupabaseClient<Database>;
let staffAal1: SupabaseClient<Database>;
let adminAal2: SupabaseClient<Database>;
let adminAal1: SupabaseClient<Database>;

beforeAll(async () => {
  // Primero las sesiones aal2 (enrolan el factor); después las aal1, con el factor ya verificado.
  staffAal2 = await signIn(STAFF);
  await completeSecondFactor(staffAal2);
  adminAal2 = await signIn(ADMIN);
  await completeSecondFactor(adminAal2);
  staffAal1 = await signIn(STAFF);
  adminAal1 = await signIn(ADMIN);
});

describe('RLS de aal2 — lectura', () => {
  // "No lee nada": vacío por la RLS, o permiso denegado donde staff no tiene grant (audit_logs).
  it.each(PANEL_TABLES)(
    'a staff session without the second factor reads nothing from %s',
    async (table) => {
      const { data, error } = await staffAal1.from(table).select('*').limit(1);
      if (error) expect(error.code).toBe(PERMISSION_DENIED);
      else expect(data).toEqual([]);
    },
  );

  it('a staff session with the second factor reads the panel as before', async () => {
    const [users, tours] = await Promise.all([
      staffAal2.from('users').select('id'),
      staffAal2.from('tours').select('id'),
    ]);
    expect(users.data?.length).toBeGreaterThan(0);
    expect(tours.data?.length).toBeGreaterThan(0);
  });
});

describe('RLS de aal2 — escritura', () => {
  it('an admin session without the second factor cannot update a tour', async () => {
    // Arrange
    const { data: before } = await service
      .from('tours')
      .select('id, name_es')
      .eq('kind', 'day')
      .single();

    // Act
    await adminAal1.from('tours').update({ name_es: 'Cambio sin MFA' }).eq('id', before!.id);

    // Assert
    const { data: after } = await service
      .from('tours')
      .select('name_es')
      .eq('id', before!.id)
      .single();
    expect(after!.name_es).toBe(before!.name_es);
  });

  it('an admin session with the second factor updates it', async () => {
    // Arrange
    const { data: before } = await service
      .from('tours')
      .select('id, name_es')
      .eq('kind', 'day')
      .single();

    // Act
    const { data } = await adminAal2
      .from('tours')
      .update({ name_es: 'Cambio con MFA' })
      .eq('id', before!.id)
      .select('name_es');

    // Assert
    expect(data).toEqual([{ name_es: 'Cambio con MFA' }]);
    await service.from('tours').update({ name_es: before!.name_es }).eq('id', before!.id);
  });
});

describe('Storage de aal2', () => {
  it('rejects a tour image upload from an admin session without the second factor', async () => {
    const path = `mfa-test-${crypto.randomUUID()}.png`;
    const { error } = await adminAal1.storage
      .from(TOUR_IMAGES_BUCKET)
      .upload(path, PIXEL_PNG, { contentType: 'image/png' });
    expect(error).not.toBeNull();
  });

  it('accepts it from an admin session with the second factor', async () => {
    const path = `mfa-test-${crypto.randomUUID()}.png`;
    const { error } = await adminAal2.storage
      .from(TOUR_IMAGES_BUCKET)
      .upload(path, PIXEL_PNG, { contentType: 'image/png' });
    expect(error).toBeNull();
    await service.storage.from(TOUR_IMAGES_BUCKET).remove([path]);
  });
});

describe('panel_tables_missing_aal2 (auditoría no enumerativa)', () => {
  it('finds no table reachable by authenticated users without the aal2 policy', async () => {
    const { data, error } = await service.rpc('panel_tables_missing_aal2');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('only service_role runs it', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, OPTIONS);
    for (const client of [anon, staffAal2]) {
      const { error } = await client.rpc('panel_tables_missing_aal2' as never);
      expect(error?.code).toBe(PERMISSION_DENIED);
    }
  });
});

describe('supuestos de GoTrue (spec 0049 §5.1)', () => {
  it('puts aal2 and the panel role in the token after verifying the second factor', async () => {
    const { data } = await staffAal2.auth.getSession();
    expect(claimsOf(data.session!.access_token)).toMatchObject({ aal: 'aal2', user_role: 'staff' });
  });

  it('does not let a password-only session enroll another factor or remove the existing one', async () => {
    // Arrange
    const { data: factors } = await staffAal1.auth.mfa.listFactors();
    const verified = factors!.totp.find((f) => f.status === 'verified')!;

    // Act
    const enroll = await staffAal1.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `otro-${crypto.randomUUID()}`,
    });
    const unenroll = await staffAal1.auth.mfa.unenroll({ factorId: verified.id });

    // Assert
    expect(enroll.error?.code).toBe('insufficient_aal');
    expect(unenroll.error?.code).toBe('insufficient_aal');
  });

  it('does not let a password-only session change the password when there is a factor', async () => {
    const { error } = await staffAal1.auth.updateUser({ password: 'Otra-Clave-Valida-123' });
    expect(error?.code).toBe('insufficient_aal');
  });
});
