// confirm_booking encola las dos notificaciones — tests de integración
// Requiere: supabase start (Docker Desktop)
// Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TEST_SLUG = `notif-enqueue-${crypto.randomUUID().slice(0, 8)}`;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

let tourId: string;
let scheduleId: string;
let instanceId: string;
let nearInstanceId: string;

beforeAll(async () => {
  await admin.from('tours').delete().eq('slug', TEST_SLUG);

  const { data: tour, error: tourErr } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'Tour notif',
      name_en: 'Notif tour',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'Plaza ES',
      meeting_point_en: 'Plaza EN',
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

  const farStartsAt = new Date(Date.now() + TWENTY_FIVE_HOURS_MS).toISOString();
  const { data: far } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: farStartsAt,
      ends_at: farStartsAt,
      capacity_total: 5,
    })
    .select('id')
    .single();
  instanceId = far!.id;

  const nearStartsAt = new Date(Date.now() + TWO_HOURS_MS).toISOString();
  const { data: near } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: nearStartsAt,
      ends_at: nearStartsAt,
      capacity_total: 5,
    })
    .select('id')
    .single();
  nearInstanceId = near!.id;
});

afterAll(async () => {
  await admin
    .from('notifications')
    .delete()
    .in(
      'booking_id',
      (await admin.from('bookings').select('id').eq('tour_instance_id', instanceId)).data?.map(
        (b) => b.id,
      ) ?? [],
    );
  await admin.from('bookings').delete().in('tour_instance_id', [instanceId, nearInstanceId]);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
});

async function createBookingAndPayment(args: {
  tourInstanceId: string;
  email: string;
  locale: 'es' | 'en';
}) {
  const externalId = `ext-${crypto.randomUUID()}`;
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: args.tourInstanceId,
      customer_name: 'Test User',
      customer_email: args.email,
      tickets_adult: 1,
      total_amount_cents: 5_000,
      locale: args.locale,
    })
    .select('id')
    .single();

  await admin.from('payments').insert({
    booking_id: booking!.id,
    external_payment_id: externalId,
    amount_cents: 5_000,
  });

  return { bookingId: booking!.id, externalPaymentId: externalId };
}

describe('confirm_booking encola notifications', () => {
  it('inserta booking_confirmation con scheduled_for = now y reminder_24h = starts_at - 24h', async () => {
    const { bookingId, externalPaymentId } = await createBookingAndPayment({
      tourInstanceId: instanceId,
      email: 'far@example.com',
      locale: 'es',
    });

    const before = Date.now();
    const { error } = await admin.rpc('confirm_booking', {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_total_seats: 1,
    });
    expect(error).toBeNull();

    const { data: notifs } = await admin
      .from('notifications')
      .select('kind, recipient_email, locale, status, scheduled_for')
      .eq('booking_id', bookingId)
      .order('kind', { ascending: true });

    expect(notifs).toHaveLength(2);
    expect(notifs!.map((n) => n.kind).sort()).toEqual(['booking_confirmation', 'reminder_24h']);

    for (const n of notifs!) {
      expect(n.status).toBe('pending');
      expect(n.recipient_email).toBe('far@example.com');
      expect(n.locale).toBe('es');
    }

    const confirmation = notifs!.find((n) => n.kind === 'booking_confirmation')!;
    expect(new Date(confirmation.scheduled_for).getTime()).toBeGreaterThanOrEqual(before - 5_000);

    const { data: instance } = await admin
      .from('tour_instances')
      .select('starts_at')
      .eq('id', instanceId)
      .single();
    const expectedReminder = new Date(instance!.starts_at).getTime() - 24 * 60 * 60 * 1000;
    const reminder = notifs!.find((n) => n.kind === 'reminder_24h')!;
    expect(Math.abs(new Date(reminder.scheduled_for).getTime() - expectedReminder)).toBeLessThan(
      5_000,
    );
  });

  it('llamar dos veces a confirm_booking no duplica las notifications (unique constraint)', async () => {
    const { bookingId, externalPaymentId } = await createBookingAndPayment({
      tourInstanceId: instanceId,
      email: 'dup@example.com',
      locale: 'en',
    });

    await admin.rpc('confirm_booking', {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_total_seats: 1,
    });
    await admin.rpc('confirm_booking', {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_total_seats: 1,
    });

    const { data: notifs } = await admin
      .from('notifications')
      .select('id, locale')
      .eq('booking_id', bookingId);
    expect(notifs).toHaveLength(2);
    expect(notifs!.every((n) => n.locale === 'en')).toBe(true);
  });

  it('reminder con starts_at en menos de 24h queda con scheduled_for en el pasado', async () => {
    const { bookingId, externalPaymentId } = await createBookingAndPayment({
      tourInstanceId: nearInstanceId,
      email: 'near@example.com',
      locale: 'es',
    });

    await admin.rpc('confirm_booking', {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_total_seats: 1,
    });

    const { data: reminder } = await admin
      .from('notifications')
      .select('scheduled_for')
      .eq('booking_id', bookingId)
      .eq('kind', 'reminder_24h')
      .single();

    expect(new Date(reminder!.scheduled_for).getTime()).toBeLessThan(Date.now());
  });
});
