// Grants de EXECUTE de las funciones privilegiadas (hotfix seguridad 2026-06-11).
// Regresión del hallazgo CRÍTICO de la 2da auditoría: `REVOKE ... FROM PUBLIC` NO
// alcanza en Supabase (anon/authenticated tienen GRANT por default privileges), así
// que las RPC SECURITY DEFINER eran invocables por anon vía PostgREST (bypass de pago,
// refund arbitrario, etc.). Acá se verifica con clientes reales que:
//   - anon NO puede ejecutar ninguna función privilegiada (42501),
//   - authenticated tampoco puede ejecutar las que mutan estado,
//   - service_role SÍ puede (la app las llama así; no debe romperse).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const PERMISSION_DENIED = '42501';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Funciones SECURITY DEFINER que mutan estado: deben quedar fuera del alcance de
// anon Y authenticated (la app las invoca con service_role).
const STATE_MUTATING: Record<string, Record<string, unknown>> = {
  create_hold_atomic: { p_instance_id: ZERO_UUID, p_seats: 1, p_session: 'x' },
  confirm_booking: { p_booking_id: ZERO_UUID, p_external_payment_id: 'x', p_total_seats: 1 },
  cancel_booking: { p_booking_id: ZERO_UUID, p_actor_type: 'tourist', p_refund_amount_cents: 1 },
  settle_refund: { p_refund_id: ZERO_UUID },
  flag_payment_mismatch: {
    p_booking_id: ZERO_UUID,
    p_paid_amount_cents: 1,
    p_paid_currency: 'USD',
    p_source: 'x',
  },
  cancel_stale_pending_booking: { p_booking_id: ZERO_UUID, p_reason: 'x' },
  check_rate_limit: { p_key: 'test-grants', p_limit: 1, p_window_seconds: 60 },
};

// Reportes: SECURITY INVOKER, los llama el panel con sesión authenticated. anon no.
const REPORT_ARGS = { p_from: '2020-01-01T00:00:00Z', p_to: '2030-01-01T00:00:00Z' };
const REPORTS = ['report_revenue', 'report_occupancy', 'report_refunds_summary'] as const;

const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
let staff: SupabaseClient;

beforeAll(async () => {
  staff = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await staff.auth.signInWithPassword({
    email: 'staff@bokatrails.com',
    password: 'staff1234',
  });
  if (error) throw new Error(`signIn staff: ${error.message}`);
});

describe('EXECUTE de funciones privilegiadas (hotfix seguridad)', () => {
  it.each(Object.entries(STATE_MUTATING))('anon NO puede ejecutar %s', async (fn, args) => {
    const { error } = await anon.rpc(fn, args);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(Object.entries(STATE_MUTATING))(
    'authenticated (staff) NO puede ejecutar %s',
    async (fn, args) => {
      const { error } = await staff.rpc(fn, args);
      expect(error?.code).toBe(PERMISSION_DENIED);
    },
  );

  it.each(Object.entries(STATE_MUTATING))(
    'service_role SÍ ejecuta %s (la app no se rompe)',
    async (fn, args) => {
      const { error } = await service.rpc(fn, args);
      // Ejecuta: o devuelve datos (error null) o falla con su error de negocio
      // interno (P0001), pero NUNCA por permiso denegado.
      expect(error?.code).not.toBe(PERMISSION_DENIED);
      await service.from('rate_limits').delete().eq('key', 'test-grants');
    },
  );

  it.each(REPORTS)('anon NO puede ejecutar el reporte %s', async (fn) => {
    const { error } = await anon.rpc(fn, REPORT_ARGS);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(REPORTS)('authenticated (staff) SÍ ejecuta el reporte %s', async (fn) => {
    const { error } = await staff.rpc(fn, REPORT_ARGS);
    expect(error?.code).not.toBe(PERMISSION_DENIED);
  });

  // Regresión no enumerativa: cubre funciones SECURITY DEFINER FUTURAS. Si alguien crea
  // una nueva sin revocar anon/authenticated (el patrón que causó el bug), aparece acá.
  it('ninguna función SECURITY DEFINER de public es ejecutable por anon/authenticated', async () => {
    const { data, error } = await service.rpc('secdef_functions_public_executable');
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
