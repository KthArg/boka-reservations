// Guard de sobreventa en confirm_booking (spec 0023, P2). Verifica el borde exacto de la
// comparación de capacidad: confirmar justo HASTA capacity_total NO marca sobrecupo; el primer
// asiento que lo EXCEDE marca audit_logs `booking.overbooked` y confirma igual (nunca rechaza el
// pago); y la idempotencia se mantiene (reconfirmar no duplica cupo ni audit).
// Requiere: supabase start. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TEST_SLUG = `overbook-${crypto.randomUUID().slice(0, 8)}`;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
const instanceIds: string[] = [];
const eventIds: string[] = [];
let tourId: string;
let scheduleId: string;

async function createInstance(capacityTotal: number): Promise<string> {
  const startsAt = new Date(Date.now() + TWENTY_FIVE_HOURS_MS).toISOString();
  const { data } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: startsAt,
      ends_at: startsAt,
      capacity_total: capacityTotal,
    })
    .select('id')
    .single();
  instanceIds.push(data!.id);
  return data!.id;
}

async function seedBooking(
  instanceId: string,
  seats: number,
): Promise<{ bookingId: string; externalPaymentId: string }> {
  const externalPaymentId = `pi_${crypto.randomUUID()}`;
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      customer_name: 'Overbook Test',
      customer_email: `ob-${crypto.randomUUID().slice(0, 8)}@example.com`,
      tickets_adult: seats,
      total_amount_cents: 5000,
      locale: 'es',
    })
    .select('id')
    .single();
  await admin.from('payments').insert({
    booking_id: booking!.id,
    external_payment_id: externalPaymentId,
    amount_cents: 5000,
  });
  return { bookingId: booking!.id, externalPaymentId };
}

async function confirm(
  bookingId: string,
  externalPaymentId: string,
  seats: number,
): Promise<string> {
  const eventId = `evt_ob_${crypto.randomUUID()}`;
  eventIds.push(eventId);
  const { error } = await admin.rpc('confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
    p_total_seats: seats,
    p_event_id: eventId,
  });
  if (error) throw new Error(`confirm_booking: ${error.message}`);
  return eventId;
}

async function reconfirm(
  bookingId: string,
  externalPaymentId: string,
  seats: number,
  eventId: string,
): Promise<void> {
  const { error } = await admin.rpc('confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
    p_total_seats: seats,
    p_event_id: eventId,
  });
  if (error) throw new Error(`reconfirm: ${error.message}`);
}

async function reserved(instanceId: string): Promise<number> {
  const { data } = await admin
    .from('tour_instances')
    .select('capacity_reserved')
    .eq('id', instanceId)
    .single();
  return data!.capacity_reserved;
}

async function overbookedCount(bookingId: string): Promise<number> {
  const { count } = await admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('entity_id', bookingId)
    .eq('action', 'booking.overbooked');
  return count ?? 0;
}

async function status(bookingId: string): Promise<string> {
  const { data } = await admin.from('bookings').select('status').eq('id', bookingId).single();
  return data!.status;
}

beforeAll(async () => {
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
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
      max_capacity: 10,
    })
    .select('id')
    .single();
  tourId = tour!.id;
  const { data: sched } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 1, start_time: '08:00', capacity: 10 })
    .select('id')
    .single();
  scheduleId = sched!.id;
});

afterAll(async () => {
  const { data: bks } = await admin
    .from('bookings')
    .select('id')
    .in('tour_instance_id', instanceIds);
  for (const b of bks ?? []) {
    await admin.from('notifications').delete().eq('booking_id', b.id);
    await admin.from('payments').delete().eq('booking_id', b.id);
  }
  await admin.from('bookings').delete().in('tour_instance_id', instanceIds);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
  for (const id of eventIds) await admin.from('processed_webhook_events').delete().eq('id', id);
});

describe('confirm_booking — guard de sobreventa (spec 0023)', () => {
  it('confirmar justo HASTA capacity_total NO marca sobrecupo', async () => {
    const instanceId = await createInstance(2);
    const { bookingId, externalPaymentId } = await seedBooking(instanceId, 2);

    await confirm(bookingId, externalPaymentId, 2); // 0 + 2 == 2, no excede

    expect(await reserved(instanceId)).toBe(2);
    expect(await status(bookingId)).toBe('confirmed');
    expect(await overbookedCount(bookingId)).toBe(0);
  });

  it('el asiento que EXCEDE el cupo marca booking.overbooked, confirma igual y es idempotente', async () => {
    const instanceId = await createInstance(1);
    const a = await seedBooking(instanceId, 1);
    const b = await seedBooking(instanceId, 1);

    await confirm(a.bookingId, a.externalPaymentId, 1); // 0 + 1 == 1, no excede
    expect(await overbookedCount(a.bookingId)).toBe(0);

    const eventB = await confirm(b.bookingId, b.externalPaymentId, 1); // 1 + 1 = 2 > 1, excede
    expect(await status(b.bookingId)).toBe('confirmed'); // nunca se rechaza el pago
    expect(await reserved(instanceId)).toBe(2); // refleja la realidad, no se capea
    expect(await overbookedCount(b.bookingId)).toBe(1);

    // Idempotencia: reconfirmar el mismo evento no duplica cupo ni audit.
    await reconfirm(b.bookingId, b.externalPaymentId, 1, eventB);
    expect(await reserved(instanceId)).toBe(2);
    expect(await overbookedCount(b.bookingId)).toBe(1);
  });
});
