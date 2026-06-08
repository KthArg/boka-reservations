// Idempotencia del webhook DENTRO de confirm_booking (misma transacción).
// Verifica que el registro en processed_webhook_events se commitea con la
// confirmación y se hace rollback si la confirmación falla.
// Requiere: supabase start (Docker Desktop). Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TEST_SLUG = `webhook-idem-${crypto.randomUUID().slice(0, 8)}`;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
const eventIds: string[] = [];

let tourId: string;
let instanceId: string;

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
  const startsAt = new Date(Date.now() + TWENTY_FIVE_HOURS_MS).toISOString();
  const { data: inst } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: sched!.id,
      starts_at: startsAt,
      ends_at: startsAt,
      capacity_total: 5,
    })
    .select('id')
    .single();
  instanceId = inst!.id;
});

afterAll(async () => {
  const { data: bks } = await admin
    .from('bookings')
    .select('id')
    .eq('tour_instance_id', instanceId);
  for (const b of bks ?? []) {
    await admin.from('notifications').delete().eq('booking_id', b.id);
    await admin.from('payments').delete().eq('booking_id', b.id);
  }
  await admin.from('bookings').delete().eq('tour_instance_id', instanceId);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
  for (const id of eventIds) await admin.from('processed_webhook_events').delete().eq('id', id);
});

async function seedBooking(): Promise<{ bookingId: string; externalPaymentId: string }> {
  const externalPaymentId = `pi_${crypto.randomUUID()}`;
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      customer_name: 'Webhook Idem',
      customer_email: `w-${crypto.randomUUID().slice(0, 8)}@example.com`,
      tickets_adult: 1,
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

async function eventExists(id: string): Promise<boolean> {
  const { count } = await admin
    .from('processed_webhook_events')
    .select('id', { count: 'exact', head: true })
    .eq('id', id);
  return (count ?? 0) > 0;
}

describe('idempotencia del webhook en confirm_booking', () => {
  it('confirma y registra el evento en la misma transacción', async () => {
    const { bookingId, externalPaymentId } = await seedBooking();
    const eventId = `evt_ok_${crypto.randomUUID()}`;
    eventIds.push(eventId);

    const { error } = await admin.rpc('confirm_booking', {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_total_seats: 1,
      p_event_id: eventId,
    });

    expect(error).toBeNull();
    expect(await eventExists(eventId)).toBe(true);
    const { data: booking } = await admin
      .from('bookings')
      .select('status')
      .eq('id', bookingId)
      .single();
    expect(booking!.status).toBe('confirmed');
  });

  it('si la confirmación falla, el evento NO queda registrado (rollback) — el retry puede reprocesar', async () => {
    const eventId = `evt_rollback_${crypto.randomUUID()}`;
    const missingBookingId = crypto.randomUUID();

    // confirm_booking inserta el evento y luego hace RAISE EXCEPTION
    // 'BOOKING_NOT_FOUND' al no hallar la reserva: toda la transacción revierte.
    const { error } = await admin.rpc('confirm_booking', {
      p_booking_id: missingBookingId,
      p_external_payment_id: 'pi_inexistente',
      p_total_seats: 1,
      p_event_id: eventId,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain('BOOKING_NOT_FOUND');
    // La clave del fix: el evento NO persiste, así que OnvoPay puede reintentar.
    expect(await eventExists(eventId)).toBe(false);
  });

  it('reentrega del mismo evento: idempotente, sin error ni doble confirmación', async () => {
    const { bookingId, externalPaymentId } = await seedBooking();
    const eventId = `evt_dup_${crypto.randomUUID()}`;
    eventIds.push(eventId);

    const args = {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_total_seats: 1,
      p_event_id: eventId,
    };
    const first = await admin.rpc('confirm_booking', args);
    const second = await admin.rpc('confirm_booking', args);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const { count: eventCount } = await admin
      .from('processed_webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('id', eventId);
    expect(eventCount).toBe(1);

    const { data: reserved } = await admin
      .from('tour_instances')
      .select('capacity_reserved')
      .eq('id', instanceId)
      .single();
    // 1 de este test + 1 del primer test (mismo instance) = 2; nunca 3 (no doble conteo).
    expect(reserved!.capacity_reserved).toBeLessThanOrEqual(2);
  });
});
