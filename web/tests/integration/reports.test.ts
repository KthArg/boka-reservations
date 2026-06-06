// Reportes (spec 0012) — integración contra DB real. Las RPC se llaman con una
// sesión AUTENTICADA de admin (no service_role) para validar el camino real
// SECURITY INVOKER + RLS + grant (igual lección que el bug RLS del 0011).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Ventana aislada en el pasado (sin otros datos del seed). Las salidas quedan
// en el pasado respecto a now(), así aplica el no-show.
const P_FROM = '2024-02-01T00:00:00Z';
const P_TO = '2024-03-01T00:00:00Z';
const IN_WINDOW = '2024-02-10T15:00:00Z';

type BookingStatus = NonNullable<Database['public']['Tables']['bookings']['Insert']['status']>;

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
let authed: SupabaseClient<Database>;
let tourId: string;
let instanceId: string;

async function seedBooking(
  status: BookingStatus,
  ticketsAdult: number,
  checkedIn: boolean,
): Promise<string> {
  const { data } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      customer_name: 'Report Test',
      customer_email: `rep-${crypto.randomUUID().slice(0, 8)}@example.com`,
      tickets_adult: ticketsAdult,
      total_amount_cents: ticketsAdult * 5000,
      status,
      locale: 'es',
      checked_in_at: checkedIn ? IN_WINDOW : null,
    })
    .select('id')
    .single();
  return data!.id;
}

async function seedPayment(bookingId: string, cents: number): Promise<string> {
  const { data } = await admin
    .from('payments')
    .insert({
      booking_id: bookingId,
      external_payment_id: `pi_${crypto.randomUUID()}`,
      amount_cents: cents,
      status: 'succeeded',
      created_at: IN_WINDOW,
    })
    .select('id')
    .single();
  return data!.id;
}

beforeAll(async () => {
  authed = createClient<Database>(SUPABASE_URL, ANON_KEY);
  await authed.auth.signInWithPassword({ email: 'admin@bokatrails.com', password: 'admin1234' });

  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: `report-${crypto.randomUUID().slice(0, 8)}`,
      name_es: 'Tour Reporte',
      name_en: 'Report Tour',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'P',
      meeting_point_en: 'P',
      includes_es: 'g',
      includes_en: 'g',
      min_participants: 1,
      max_capacity: 10,
    })
    .select('id')
    .single();
  tourId = tour!.id;

  const { data: sched } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 6, start_time: '15:00', capacity: 10 })
    .select('id')
    .single();
  const { data: inst } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: sched!.id,
      starts_at: IN_WINDOW,
      ends_at: IN_WINDOW,
      capacity_total: 10,
    })
    .select('id')
    .single();
  instanceId = inst!.id;

  // B1 confirmed, 2 tickets, con check-in (no es no-show). Pago 10000.
  const b1 = await seedBooking('confirmed', 2, true);
  await seedPayment(b1, 10000);
  // B2 confirmed, 3 tickets, sin check-in (no-show, salida pasada). Pago 15000.
  const b2 = await seedBooking('confirmed', 3, false);
  await seedPayment(b2, 15000);
  // B3 cancelled, 1 ticket. Pago 5000 + refund 5000.
  const b3 = await seedBooking('cancelled', 1, false);
  const p3 = await seedPayment(b3, 5000);
  await admin.from('refunds').insert({
    booking_id: b3,
    payment_id: p3,
    amount_cents: 5000,
    currency: 'USD',
    status: 'succeeded',
    created_at: IN_WINDOW,
  });
  // B4 pending_payment, 1 ticket (debe excluirse de los conteos válidos).
  await seedBooking('pending_payment', 1, false);
});

afterAll(async () => {
  const { data: bks } = await admin
    .from('bookings')
    .select('id')
    .eq('tour_instance_id', instanceId);
  for (const b of bks ?? []) {
    await admin.from('refunds').delete().eq('booking_id', b.id);
    await admin.from('payments').delete().eq('booking_id', b.id);
  }
  await admin.from('bookings').delete().eq('tour_instance_id', instanceId);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
});

describe('reportes (RPC con sesión autenticada admin)', () => {
  it('report_revenue: bruto, reembolsado y neto por tour', async () => {
    const { data, error } = await authed.rpc('report_revenue', { p_from: P_FROM, p_to: P_TO });
    expect(error).toBeNull();
    const row = (data ?? []).find((r) => r.tour_id === tourId);
    expect(row).toBeDefined();
    expect(row!.gross_cents).toBe(30000); // 10000 + 15000 + 5000
    expect(row!.refunded_cents).toBe(5000);
    expect(row!.net_cents).toBe(25000);
  });

  it('report_occupancy: reservas, tiquetes, ocupación y no-show', async () => {
    const { data, error } = await authed.rpc('report_occupancy', { p_from: P_FROM, p_to: P_TO });
    expect(error).toBeNull();
    const row = (data ?? []).find((r) => r.tour_id === tourId);
    expect(row).toBeDefined();
    expect(row!.bookings_count).toBe(2); // B1 + B2 confirmed
    expect(row!.tickets_sold).toBe(5); // 2 + 3
    expect(row!.capacity_total).toBe(10);
    expect(row!.occupancy_pct).toBeCloseTo(0.5, 5);
    expect(row!.no_show_count).toBe(1); // B2 (sin check-in)
    expect(row!.past_bookings_count).toBe(2);
  });

  it('report_refunds_summary: refunds y base de la tasa de cancelación', async () => {
    const { data, error } = await authed.rpc('report_refunds_summary', {
      p_from: P_FROM,
      p_to: P_TO,
    });
    expect(error).toBeNull();
    const row = data![0];
    expect(row.refunds_count).toBe(1);
    expect(row.refunds_amount_cents).toBe(5000);
    expect(row.cancelled_count).toBe(1); // B3
    expect(row.valid_bookings_count).toBe(3); // B1, B2, B3 (B4 pending excluido)
  });
});
