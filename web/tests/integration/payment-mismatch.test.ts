// flag_payment_mismatch (spec 0014): marca una reserva con pago no coincidente.
// Requiere: supabase start (Docker Desktop). Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TEST_SLUG = `pay-mismatch-${crypto.randomUUID().slice(0, 8)}`;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
const EXPECTED_CENTS = 5000;

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
});

async function seedBooking(): Promise<{ bookingId: string; externalPaymentId: string }> {
  const externalPaymentId = `pi_${crypto.randomUUID()}`;
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      customer_name: 'Mismatch Test',
      customer_email: `m-${crypto.randomUUID().slice(0, 8)}@example.com`,
      tickets_adult: 1,
      total_amount_cents: EXPECTED_CENTS,
      locale: 'es',
    })
    .select('id')
    .single();
  await admin.from('payments').insert({
    booking_id: booking!.id,
    external_payment_id: externalPaymentId,
    amount_cents: EXPECTED_CENTS,
  });
  return { bookingId: booking!.id, externalPaymentId };
}

async function bookingStatus(id: string): Promise<string> {
  const { data } = await admin.from('bookings').select('status').eq('id', id).single();
  return data!.status;
}

describe('flag_payment_mismatch', () => {
  it('marca payment_mismatch, no toca el pago, audita esperado vs pagado', async () => {
    const { bookingId } = await seedBooking();

    const { data: flagged, error } = await admin.rpc('flag_payment_mismatch', {
      p_booking_id: bookingId,
      p_paid_amount_cents: 9999,
      p_paid_currency: 'USD',
      p_source: 'webhook',
    });

    expect(error).toBeNull();
    expect(flagged).toBe(true);
    expect(await bookingStatus(bookingId)).toBe('payment_mismatch');

    const { data: payment } = await admin
      .from('payments')
      .select('status')
      .eq('booking_id', bookingId)
      .single();
    expect(payment!.status).toBe('pending'); // no se reconoce como ingreso

    const { data: audit } = await admin
      .from('audit_logs')
      .select('action, metadata')
      .eq('entity_id', bookingId)
      .eq('action', 'booking.payment_mismatch')
      .single();
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta.expected_amount_cents).toBe(EXPECTED_CENTS);
    expect(meta.paid_amount_cents).toBe(9999);
    expect(meta.source).toBe('webhook');
  });

  it('idempotente: sobre una reserva ya en payment_mismatch devuelve false', async () => {
    const { bookingId } = await seedBooking();
    const args = {
      p_booking_id: bookingId,
      p_paid_amount_cents: 9999,
      p_paid_currency: 'USD',
      p_source: 'webhook',
    };

    const first = await admin.rpc('flag_payment_mismatch', args);
    const second = await admin.rpc('flag_payment_mismatch', args);

    expect(first.data).toBe(true);
    expect(second.data).toBe(false); // ya no está en pending_payment
    expect(await bookingStatus(bookingId)).toBe('payment_mismatch');
  });

  it('no marca una reserva ya confirmada (devuelve false)', async () => {
    const { bookingId, externalPaymentId } = await seedBooking();
    await admin.rpc('confirm_booking', {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_total_seats: 1,
    });
    expect(await bookingStatus(bookingId)).toBe('confirmed');

    const { data: flagged } = await admin.rpc('flag_payment_mismatch', {
      p_booking_id: bookingId,
      p_paid_amount_cents: 9999,
      p_paid_currency: 'USD',
      p_source: 'reconcile',
    });

    expect(flagged).toBe(false);
    expect(await bookingStatus(bookingId)).toBe('confirmed');
  });
});
