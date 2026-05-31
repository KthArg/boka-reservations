// Job send-notifications — tests de integración contra DB y Mailpit reales
// Requiere: supabase start (Docker Desktop) con smtp_port=54325 en config.toml
// Ejecutar: pnpm --filter worker test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendNotifications } from '../../src/jobs/send-notifications.js';
import type { Database } from '../../../web/types/database.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const MAILPIT_API = 'http://127.0.0.1:54324/api/v1';

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TEST_SLUG = `notif-job-${crypto.randomUUID().slice(0, 8)}`;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;

let tourId: string;
let scheduleId: string;
let instanceId: string;

async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' }).catch(() => undefined);
}

async function listMailpitMessages(): Promise<
  Array<{ Subject: string; To: Array<{ Address: string }> }>
> {
  const res = await fetch(`${MAILPIT_API}/messages`);
  const json = (await res.json()) as {
    messages: Array<{ Subject: string; To: Array<{ Address: string }> }>;
  };
  return json.messages ?? [];
}

beforeAll(async () => {
  const { data: tour, error: tourErr } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'Tour notif job',
      name_en: 'Notif job tour',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'Plaza',
      meeting_point_en: 'Plaza',
      includes_es: 'g',
      includes_en: 'g',
      min_participants: 1,
      max_capacity: 5,
      status: 'active',
    })
    .select('id')
    .single();
  if (tourErr || !tour) throw tourErr ?? new Error('no tour');
  tourId = tour.id;

  const { data: sched } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 1, start_time: '08:00', capacity: 5 })
    .select('id')
    .single();
  scheduleId = sched!.id;

  const startsAt = new Date(Date.now() + TWENTY_FIVE_HOURS_MS).toISOString();
  const { data: inst } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: startsAt,
      ends_at: startsAt,
      capacity_total: 5,
    })
    .select('id')
    .single();
  instanceId = inst!.id;
});

afterAll(async () => {
  const { data: bookings } = await admin
    .from('bookings')
    .select('id')
    .eq('tour_instance_id', instanceId);
  const bookingIds = (bookings ?? []).map((b) => b.id);
  if (bookingIds.length > 0) {
    await admin.from('notifications').delete().in('booking_id', bookingIds);
    await admin.from('payments').delete().in('booking_id', bookingIds);
    await admin.from('bookings').delete().in('id', bookingIds);
  }
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
});

beforeEach(async () => {
  await clearMailpit();
});

afterEach(async () => {
  const { data: bookings } = await admin
    .from('bookings')
    .select('id')
    .eq('tour_instance_id', instanceId);
  const bookingIds = (bookings ?? []).map((b) => b.id);
  if (bookingIds.length > 0) {
    await admin.from('notifications').delete().in('booking_id', bookingIds);
    await admin.from('payments').delete().in('booking_id', bookingIds);
    await admin.from('bookings').delete().in('id', bookingIds);
  }
});

async function createConfirmedBooking(email: string): Promise<string> {
  const externalId = `ext-${crypto.randomUUID()}`;
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      customer_name: 'Worker Test',
      customer_email: email,
      tickets_adult: 1,
      total_amount_cents: 5_000,
      locale: 'es',
    })
    .select('id')
    .single();
  await admin.from('payments').insert({
    booking_id: booking!.id,
    external_payment_id: externalId,
    amount_cents: 5_000,
  });
  await admin.rpc('confirm_booking', {
    p_booking_id: booking!.id,
    p_external_payment_id: externalId,
    p_total_seats: 1,
  });
  return booking!.id;
}

describe('sendNotifications job (integración)', () => {
  it('despacha la confirmación inmediata a Mailpit y marca sent', async () => {
    const email = `dispatch-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const bookingId = await createConfirmedBooking(email);

    await sendNotifications();

    const messages = await listMailpitMessages();
    const found = messages.find((m) => m.To.some((t) => t.Address === email));
    expect(found).toBeDefined();
    expect(found!.Subject).toMatch(/confirmada/i);

    const { data: notif } = await admin
      .from('notifications')
      .select('status, sent_at, provider, provider_message_id')
      .eq('booking_id', bookingId)
      .eq('kind', 'booking_confirmation')
      .single();
    expect(notif!.status).toBe('sent');
    expect(notif!.provider).toBe('mailpit');
    expect(notif!.sent_at).toBeTruthy();
    expect(notif!.provider_message_id).toBeTruthy();
  });

  it('cancela el reminder si el booking ya esta cancelled', async () => {
    const email = `cancel-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const bookingId = await createConfirmedBooking(email);
    await admin.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId);
    await admin
      .from('notifications')
      .update({ scheduled_for: new Date().toISOString() })
      .eq('booking_id', bookingId)
      .eq('kind', 'reminder_24h');

    await sendNotifications();

    const { data: reminder } = await admin
      .from('notifications')
      .select('status, cancelled_reason')
      .eq('booking_id', bookingId)
      .eq('kind', 'reminder_24h')
      .single();
    expect(reminder!.status).toBe('cancelled');
    expect(reminder!.cancelled_reason).toBe('booking-status-cancelled');
  });
});
