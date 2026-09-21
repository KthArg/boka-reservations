// Migración …042 (spec 0028, C1): desactivación atómica anti-TOCTOU del último admin y
// refund de cancel_booking capado al pago. Requiere: supabase start.

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const PAYMENT_CENTS = 5000;
let adminA: string;
let adminB: string;
let otherAdminIds: string[] = [];
let tourId: string;
let instanceId: string;

async function mkAdmin(tag: string): Promise<string> {
  const { data, error } = await admin
    .from('users')
    .insert({
      email: `admin-${tag}-${crypto.randomUUID().slice(0, 8)}@example.com`,
      full_name: `Admin ${tag}`,
      role: 'admin',
      phone: '+506 8000-0000',
    })
    .select('id')
    .single();
  if (error) throw new Error(`mkAdmin: ${error.message}`);
  return data!.id;
}

beforeAll(async () => {
  adminA = await mkAdmin('a');
  adminB = await mkAdmin('b');
  // Para que A y B sean LOS ÚLTIMOS admins activos, se desactivan temporalmente los
  // demás (se restauran en afterAll; las suites corren en serie, sin interferencia).
  const { data: others } = await admin
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .eq('active', true)
    .not('id', 'in', `(${adminA},${adminB})`);
  otherAdminIds = (others ?? []).map((r) => r.id);
  if (otherAdminIds.length > 0) {
    await admin.from('users').update({ active: false }).in('id', otherAdminIds);
  }

  const slug = `cierres-${crypto.randomUUID().slice(0, 8)}`;
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug,
      name_es: 'T',
      name_en: 'T',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'P',
      meeting_point_en: 'P',
      includes_es: 'g',
      includes_en: 'g',
      min_participants: 1,
      max_capacity: 5,
    })
    .select('id')
    .single();
  tourId = tour!.id;
  const { data: sched } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 1, start_time: '08:00', capacity: 5 })
    .select('id')
    .single();
  const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: inst } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: sched!.id,
      starts_at: startsAt,
      ends_at: startsAt,
      capacity_total: 5,
      // Cada cancel_booking decrementa por los asientos de su reserva: 2 tests × 1 asiento.
      capacity_reserved: 2,
    })
    .select('id')
    .single();
  instanceId = inst!.id;
});

afterAll(async () => {
  if (otherAdminIds.length > 0) {
    await admin.from('users').update({ active: true }).in('id', otherAdminIds);
  }
  const { data: bks } = await admin
    .from('bookings')
    .select('id')
    .eq('tour_instance_id', instanceId);
  for (const b of bks ?? []) {
    await admin.from('notifications').delete().eq('booking_id', b.id);
    await admin.from('refunds').delete().eq('booking_id', b.id);
    await admin.from('payments').delete().eq('booking_id', b.id);
  }
  await admin.from('bookings').delete().eq('tour_instance_id', instanceId);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
  await admin.from('users').delete().in('id', [adminA, adminB]);
});

describe('deactivate_internal_user — anti-TOCTOU del último admin (…042)', () => {
  it('dos desactivaciones CONCURRENTES de los dos últimos admins: al menos uno queda activo', async () => {
    const deactivate = (id: string) => admin.rpc('deactivate_internal_user', { p_user_id: id });

    const [a, b] = await Promise.all([deactivate(adminA), deactivate(adminB)]);

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    // A lo sumo una gana; jamás las dos (el TOCTOU previo dejaba 0 admins → lockout).
    expect([a.data, b.data].filter(Boolean).length).toBeLessThanOrEqual(1);
    const { count } = await admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('active', true);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('el último admin activo no puede desactivarse (RPC devuelve false)', async () => {
    const { data: actives } = await admin
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .eq('active', true);
    expect(actives!.length).toBe(1);
    const last = actives![0].id;

    const { data, error } = await admin.rpc('deactivate_internal_user', { p_user_id: last });

    expect(error).toBeNull();
    expect(data).toBe(false);
    const { data: still } = await admin.from('users').select('active').eq('id', last).single();
    expect(still!.active).toBe(true);
  });
});

describe('cancel_booking — refund capado al pago (…042)', () => {
  async function seedConfirmed(): Promise<{ bookingId: string }> {
    const { data: booking } = await admin
      .from('bookings')
      .insert({
        tour_instance_id: instanceId,
        customer_name: 'Cap Test',
        customer_email: `cap-${crypto.randomUUID().slice(0, 8)}@example.com`,
        tickets_adult: 1,
        total_amount_cents: PAYMENT_CENTS,
        locale: 'es',
        status: 'confirmed',
      })
      .select('id')
      .single();
    await admin.from('payments').insert({
      booking_id: booking!.id,
      external_payment_id: `pi_${crypto.randomUUID()}`,
      amount_cents: PAYMENT_CENTS,
      status: 'succeeded',
    });
    return { bookingId: booking!.id };
  }

  it('encola min(política, pago): un p_refund mayor al pago queda capado', async () => {
    const { bookingId } = await seedConfirmed();

    const { error } = await admin.rpc('cancel_booking', {
      p_booking_id: bookingId,
      p_actor_type: 'tourist',
      p_refund_amount_cents: PAYMENT_CENTS + 4999,
    });
    expect(error).toBeNull();

    const { data: refunds } = await admin
      .from('refunds')
      .select('amount_cents')
      .eq('booking_id', bookingId);
    expect(refunds).toHaveLength(1);
    expect(refunds![0].amount_cents).toBe(PAYMENT_CENTS);
  });

  it('política sin refund (0): no encola nada', async () => {
    const { bookingId } = await seedConfirmed();

    const { error } = await admin.rpc('cancel_booking', {
      p_booking_id: bookingId,
      p_actor_type: 'tourist',
      p_refund_amount_cents: 0,
    });
    expect(error).toBeNull();

    const { data: refunds } = await admin.from('refunds').select('id').eq('booking_id', bookingId);
    expect(refunds).toHaveLength(0);
  });
});
