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

const DEFERRED_BOOKING_ARGS = {
  p_hold_id: ZERO_UUID,
  p_session_token: 'x',
  p_customer_name: 'x',
  p_customer_email: 'x@example.com',
  p_locale: 'es',
  p_tickets_adult: 1,
  p_tickets_child: 0,
  p_tickets_student: 0,
  p_total_amount_cents: 1,
  p_currency: 'USD',
  p_consent_version: 'x',
  p_terms_version: 'x',
  p_payment_method_id: 'x',
  p_customer_external_id: 'x',
  p_card_brand: 'visa',
  p_card_last4: '4242',
  p_card_exp_month: 12,
  p_card_exp_year: 2099,
};

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
  // Spec 0031: firma de 18 parámetros de create_deferred_booking y las purgas nuevas o
  // reescritas. El cutoff en el pasado lejano hace que service_role no borre nada.
  create_deferred_booking: DEFERRED_BOOKING_ARGS,
  purge_stale_holds: { p_cutoff: '2000-01-01T00:00:00Z' },
  purge_old_notifications: { p_cutoff: '2000-01-01T00:00:00Z' },
  // Spec 0033: el ciclo de cobro del mínimo. resolve_departure_minimum cancela salidas y emite
  // reembolsos, y las de cancelación cierran reservas: ninguna puede quedar al alcance de anon.
  // Las dos lecturas (departure_seat_counts, departure_charge_due) van más abajo, con los
  // reportes: no mutan nada, pero tampoco son públicas.
  open_departure_charge: { p_instance_id: ZERO_UUID },
  close_departure_charge: { p_instance_id: ZERO_UUID },
  record_authorization: { p_booking_id: ZERO_UUID, p_external_payment_id: 'x' },
  release_departure_authorization: { p_booking_id: ZERO_UUID, p_external_payment_id: 'x' },
  claim_authorization_cancel: {
    p_booking_id: ZERO_UUID,
    p_actor_id: null,
    p_reason: 'customer_request',
  },
  cancel_authorized_booking: {
    p_booking_id: ZERO_UUID,
    p_actor_id: null,
    p_reason: 'customer_request',
  },
  cancel_booking_for_departure: { p_booking_id: ZERO_UUID, p_resolution: 'auto_cancelled' },
  resolve_departure_minimum: { p_instance_id: ZERO_UUID, p_resolution: 'auto_cancelled' },
};

// Lecturas del ciclo del mínimo (spec 0033): no mutan, pero exponen la configuración de cobro y
// los cupos de una salida. Solo service_role.
const DEPARTURE_READS: Record<string, Record<string, unknown>> = {
  departure_seat_counts: { p_instance_id: ZERO_UUID },
  departure_charge_due: { p_instance_id: ZERO_UUID },
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

  it.each(Object.entries(DEPARTURE_READS))(
    'ni anon ni authenticated ejecutan la lectura %s',
    async (fn, args) => {
      expect((await anon.rpc(fn, args)).error?.code).toBe(PERMISSION_DENIED);
      expect((await staff.rpc(fn, args)).error?.code).toBe(PERMISSION_DENIED);
      expect((await service.rpc(fn, args)).error?.code).not.toBe(PERMISSION_DENIED);
    },
  );

  // Spec 0032: STATE_MUTATING se indexa por nombre y no admite las dos sobrecargas de
  // cancel_booking. Sin p_reason la llamada resolvería a la de 4 parámetros y el test no
  // probaría la nueva.
  it('la sobrecarga de 6 parámetros de cancel_booking solo la ejecuta service_role', async () => {
    const args = {
      p_booking_id: ZERO_UUID,
      p_actor_type: 'tourist',
      p_refund_amount_cents: 1,
      p_reason: 'customer_request',
      p_fee_cents: 0,
    };
    expect((await anon.rpc('cancel_booking', args)).error?.code).toBe(PERMISSION_DENIED);
    expect((await staff.rpc('cancel_booking', args)).error?.code).toBe(PERMISSION_DENIED);
    const fromService = await service.rpc('cancel_booking', args);
    expect(fromService.error?.code).not.toBe(PERMISSION_DENIED);
    expect(fromService.error?.message).toContain('BOOKING_NOT_FOUND');
  });

  it('la firma de 17 parámetros de create_deferred_booking ya no existe (spec 0031)', async () => {
    const legacyArgs = Object.fromEntries(
      Object.entries(DEFERRED_BOOKING_ARGS).filter(([key]) => key !== 'p_terms_version'),
    );
    const { error } = await service.rpc('create_deferred_booking', legacyArgs);
    // PostgREST no encuentra ninguna función con esos parámetros.
    expect(error?.code).toBe('PGRST202');
  });

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

  // F-3 (spec 0019): is_public_request es SECURITY INVOKER y la auditoría de DEFINER de
  // arriba NO la cubre. Pin explícito de que quedó cerrada para roles públicos.
  it('anon/authenticated NO pueden ejecutar is_public_request (F-3)', async () => {
    const fromAnon = await anon.rpc('is_public_request');
    const fromStaff = await staff.rpc('is_public_request');
    expect(fromAnon.error?.code).toBe(PERMISSION_DENIED);
    expect(fromStaff.error?.code).toBe(PERMISSION_DENIED);
  });

  // Regresión AMPLIA (DEFINER + INVOKER, no enumerativa): cubre el agujero de F-3. Lista
  // toda función de public ejecutable por anon/authenticated, salvo triggers y la allowlist
  // de funciones intencionalmente públicas (los report_*). Si una migración futura abre una
  // función INVOKER nueva (o re-otorga EXECUTE), aparece acá y este test falla.
  it('ninguna función de public (DEFINER o INVOKER) es ejecutable por un rol público fuera de la allowlist', async () => {
    const { data, error } = await service.rpc('audit_public_executable_functions');
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
