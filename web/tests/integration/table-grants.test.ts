// Grants de TABLA explícitos para roles públicos de PostgREST (spec 0027).
// Espejo de rpc-execute-grants.test.ts pero para TABLAS en vez de funciones.
//
// La migración …038 hace explícito todo el control de exposición de tablas (deja de
// depender del grant por defecto de Supabase) y revoca el default localmente. Acá se
// verifica con clientes reales que:
//   - la red de regresión audit_table_grants_to_public_roles() devuelve 0 filas (ninguna
//     tabla queda alcanzable por anon/authenticated fuera de la allowlist explícita),
//   - anon NO puede leer las tablas service-only ni users (42501 / permission denied),
//   - anon NO puede escribir en las tablas del portal (solo conserva SELECT).
// La validación corre con el default ya revocado (db reset aplica la migración), así que
// un grant faltante daría permission denied en el flujo correspondiente.
//
// GOTCHA del proyecto: los tests que leen con service_role NO detectan un grant faltante
// (service bypassa grants+RLS). Por eso los asserts de denegación usan el cliente anon real.
// Las escrituras usan un cliente anon SIN tipar el schema (anonRaw) a propósito: el grant de
// INSERT/UPDATE/DELETE está revocado, así que PostgREST corta con 42501 ANTES de la RLS y un
// payload parcial alcanza para ejercitar la denegación a nivel grant.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const PERMISSION_DENIED = '42501';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Tablas que solo debe tocar service_role: anon no debe poder leerlas (grant revocado).
const SERVICE_ONLY_TABLES = [
  'audit_logs',
  'tour_holds',
  'guide_access_tokens',
  'booking_access_tokens',
  'processed_webhook_events',
  'rate_limits',
] as const;

// users no es service-only, pero anon tampoco la lee (grant revocado desde …009).
const ANON_DENIED_READ_TABLES = ['users', ...SERVICE_ONLY_TABLES] as const;

// Tablas del portal: anon SELECT sí, pero NO escritura (solo SELECT).
const PORTAL_TABLES = ['tours', 'tour_pricing', 'tour_schedules', 'tour_instances'] as const;

const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
// Cliente anon sin tipar: ejercita escrituras parciales contra el grant (denegación 42501).
const anonRaw = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const service = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

describe('Grants de tabla explícitos para roles públicos (spec 0027)', () => {
  // Regresión no enumerativa: si una migración futura otorga (o re-otorga) un grant de
  // tabla a anon/authenticated fuera de la allowlist, aparece acá y este test falla.
  it('ninguna tabla de public es alcanzable por un rol público fuera de la allowlist', async () => {
    const { data, error } = await service.rpc('audit_table_grants_to_public_roles');
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it.each(ANON_DENIED_READ_TABLES)('anon NO puede leer %s', async (table) => {
    const { error } = await anonRaw.from(table).select('*').limit(1);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(PORTAL_TABLES)('anon SÍ puede leer %s (portal público)', async (table) => {
    const { error } = await anon.from(table).select('*').limit(1);
    // Assert fuerte: la lectura del portal NO debe dar error alguno (no solo "≠ 42501", que
    // pasaría con un error de red). Si el SELECT del portal se revocara, esto fallaría.
    expect(error).toBeNull();
  });

  // Simétrico de la denegación anon: una sesión autenticada (panel + reportes SECURITY INVOKER)
  // DEBE poder leer estas tablas. Un REVOKE de más acá rompería el panel o los reportes report_*
  // sin que los asserts de anon lo noten — este test lo caza.
  it('una sesión autenticada (admin) SÍ puede leer las tablas del panel y reportes', async () => {
    const authed = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await authed.auth.signInWithPassword({
      email: 'admin@bokatrails.com',
      password: 'admin1234',
    });
    expect(signInError).toBeNull();

    const AUTH_READABLE_TABLES = [
      'bookings',
      'payments',
      'notifications',
      'refunds',
      'tour_instances',
      'users',
      'tour_instance_guides',
    ] as const;
    for (const table of AUTH_READABLE_TABLES) {
      const { error } = await authed.from(table).select('*').limit(1);
      expect(error, `authenticated debería poder leer ${table}`).toBeNull();
    }

    await authed.auth.signOut();
  });

  it.each(PORTAL_TABLES)('anon NO puede insertar en %s', async (table) => {
    const { error } = await anonRaw.from(table).insert({ id: ZERO_UUID });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(PORTAL_TABLES)('anon NO puede actualizar %s', async (table) => {
    const { error } = await anonRaw.from(table).update({ id: ZERO_UUID }).eq('id', ZERO_UUID);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(PORTAL_TABLES)('anon NO puede borrar de %s', async (table) => {
    const { error } = await anonRaw.from(table).delete().eq('id', ZERO_UUID);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});
