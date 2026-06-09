// Route handler del webhook OnvoPay — camino de validación de monto (spec 0014).
// Mockea el provider (verifyWebhook) y Sentry; usa el service client real contra la
// DB. Requiere: supabase start. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const EXPECTED_CENTS = 5000;

// Payload que devolverá el provider mockeado; cada test lo setea.
const providerState = vi.hoisted(() => ({
  payload: null as null | {
    eventType: string;
    eventId: string;
    paymentId: string;
    amountCents: number;
    currency: string;
    status: string;
  },
}));

vi.mock('@/lib/payments', () => ({
  getPaymentProvider: () => ({ verifyWebhook: () => providerState.payload }),
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: (cb: (scope: unknown) => void) =>
    cb({ setLevel: vi.fn(), setFingerprint: vi.fn(), setExtra: vi.fn() }),
  captureMessage: vi.fn(),
}));

const { POST } = await import('@/app/api/webhooks/onvopay/route');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
const TEST_SLUG = `webhook-handler-${crypto.randomUUID().slice(0, 8)}`;
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

beforeEach(() => {
  providerState.payload = null;
});

async function seedBooking(): Promise<{ bookingId: string; externalPaymentId: string }> {
  const externalPaymentId = `pi_${crypto.randomUUID()}`;
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      customer_name: 'Handler Test',
      customer_email: `h-${crypto.randomUUID().slice(0, 8)}@example.com`,
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

async function postWebhook(): Promise<Response> {
  const req = new NextRequest('http://localhost/api/webhooks/onvopay', {
    method: 'POST',
    body: JSON.stringify(providerState.payload),
    headers: { 'x-webhook-secret': 'mocked' },
  });
  return POST(req);
}

async function bookingStatus(id: string): Promise<string> {
  const { data } = await admin.from('bookings').select('status').eq('id', id).single();
  return data!.status;
}

function payload(over: Partial<NonNullable<typeof providerState.payload>>) {
  return {
    eventType: 'payment-intent.succeeded',
    eventId: `evt_${crypto.randomUUID()}`,
    paymentId: 'pi_unset',
    amountCents: EXPECTED_CENTS,
    currency: 'USD',
    status: 'succeeded',
    ...over,
  };
}

describe('webhook handler — validación de monto (spec 0014)', () => {
  it('monto distinto: responde 200, marca payment_mismatch y NO confirma', async () => {
    const { bookingId, externalPaymentId } = await seedBooking();
    providerState.payload = payload({ paymentId: externalPaymentId, amountCents: 9999 });

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(await bookingStatus(bookingId)).toBe('payment_mismatch');
  });

  it('monto coincidente: confirma la reserva', async () => {
    const { bookingId, externalPaymentId } = await seedBooking();
    const p = payload({ paymentId: externalPaymentId, amountCents: EXPECTED_CENTS });
    eventIds.push(p.eventId);
    providerState.payload = p;

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(await bookingStatus(bookingId)).toBe('confirmed');
  });

  it('moneda en minúsculas (usd): se normaliza y confirma, no marca mismatch', async () => {
    const { bookingId, externalPaymentId } = await seedBooking();
    const p = payload({ paymentId: externalPaymentId, currency: 'usd' });
    eventIds.push(p.eventId);
    providerState.payload = p;

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(await bookingStatus(bookingId)).toBe('confirmed');
  });
});
