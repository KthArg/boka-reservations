// Test de carga — 20 reservas secuenciales
// Verifica que el sistema no acumula errores, que capacity_reserved es correcto,
// y que processed_webhook_events registra cada evento exactamente una vez.
// Requiere: supabase start + pnpm dev (Next.js en :3000)

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const WEBHOOK_SECRET = process.env.ONVOPAY_WEBHOOK_SECRET ?? '';
const WEBHOOK_URL = 'http://localhost:3000/api/webhooks/onvopay';

const LOAD_COUNT = 20;
const TEST_SLUG = 'integration-load-test';

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

let tourId: string;
let instanceId: string;
const paymentIds: string[] = [];

async function simulateWebhook(paymentIntentId: string): Promise<number> {
  const body = JSON.stringify({
    type: 'payment-intent.succeeded',
    data: { id: paymentIntentId, status: 'succeeded', amount: 3500, currency: 'USD' },
  });
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WEBHOOK_SECRET },
    body,
  });
  return res.status;
}

beforeAll(async () => {
  await admin.from('tours').delete().eq('slug', TEST_SLUG);

  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'Tour load test',
      name_en: 'Load test tour',
      description_es: 'Desc',
      description_en: 'Desc',
      difficulty: 'easy',
      duration_minutes: 90,
      meeting_point_es: 'Entrada',
      meeting_point_en: 'Entrance',
      includes_es: 'Guía',
      includes_en: 'Guide',
      min_participants: 1,
      max_capacity: LOAD_COUNT + 10,
      status: 'active',
    })
    .select('id')
    .single();

  tourId = tour!.id;

  const { data: schedule } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 3, start_time: '10:00', capacity: LOAD_COUNT + 10 })
    .select('id')
    .single();

  const startsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(new Date(startsAt).getTime() + 90 * 60 * 1000).toISOString();

  const { data: instance } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: schedule!.id,
      starts_at: startsAt,
      ends_at: endsAt,
      capacity_total: LOAD_COUNT + 10,
      capacity_reserved: 0,
      status: 'available',
    })
    .select('id')
    .single();

  instanceId = instance!.id;

  // Crear 20 bookings + payments directamente en DB (simula el checkout)
  for (let i = 0; i < LOAD_COUNT; i++) {
    const paymentIntentId = `load-test-intent-${Date.now()}-${i}`;
    paymentIds.push(paymentIntentId);

    const { data: booking } = await admin
      .from('bookings')
      .insert({
        tour_instance_id: instanceId,
        customer_name: `Cliente Carga ${i + 1}`,
        customer_email: `carga${i + 1}@test.com`,
        tickets_adult: 1,
        tickets_child: 0,
        tickets_student: 0,
        total_amount_cents: 3500,
        currency: 'USD',
        status: 'pending_payment',
      })
      .select('id')
      .single();

    await admin.from('payments').insert({
      booking_id: booking!.id,
      external_provider: 'onvopay',
      external_payment_id: paymentIntentId,
      amount_cents: 3500,
      currency: 'USD',
      status: 'pending',
    });
  }
}, 30000);

afterAll(async () => {
  await admin.from('tours').delete().eq('id', tourId);
  // Limpiar processed_webhook_events de este test
  for (const id of paymentIds) {
    await admin.from('processed_webhook_events').delete().eq('id', id);
  }
});

describe(`carga — ${LOAD_COUNT} reservas secuenciales`, () => {
  it('todos los webhooks devuelven 200', async () => {
    const statuses: number[] = [];
    for (const paymentId of paymentIds) {
      const status = await simulateWebhook(paymentId);
      statuses.push(status);
    }
    const nonOk = statuses.filter((s) => s !== 200);
    expect(nonOk).toHaveLength(0);
  }, 60000);

  it(`capacity_reserved incrementado correctamente: ${LOAD_COUNT} asientos`, async () => {
    const { data } = await admin
      .from('tour_instances')
      .select('capacity_reserved')
      .eq('id', instanceId)
      .single();
    expect(data?.capacity_reserved).toBe(LOAD_COUNT);
  });

  it('todos los bookings están confirmed', async () => {
    const { data } = await admin
      .from('bookings')
      .select('status')
      .eq('tour_instance_id', instanceId);
    const nonConfirmed = (data ?? []).filter((b) => b.status !== 'confirmed');
    expect(nonConfirmed).toHaveLength(0);
  });

  it('processed_webhook_events tiene exactamente 1 fila por pago (sin duplicados)', async () => {
    const { data } = await admin.from('processed_webhook_events').select('id').in('id', paymentIds);
    expect(data).toHaveLength(LOAD_COUNT);
  });
});
