// Precio autoritativo del checkout (spec 0015, fix C-1). Demuestra que initCheckout calcula
// el monto desde tour_pricing y el cliente no puede influirlo: ya no existe un parámetro de
// precio que pasar. Mockea el provider de pago; usa el service client real contra la DB.
// Requiere: supabase start. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

vi.mock('@/lib/payments', () => ({
  getPaymentProvider: () => ({
    createPaymentSession: () => Promise.resolve({ externalPaymentId: `pi_${crypto.randomUUID()}` }),
    verifyWebhook: () => null,
  }),
}));

const { initCheckout } = await import('@/lib/booking/create');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
const ADULT_PRICE_USD = 50;
const ADULT_PRICE_CENTS = 5000;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
const TEST_SLUG = `checkout-price-${crypto.randomUUID().slice(0, 8)}`;
let tourId: string;
let instanceId: string;

beforeAll(async () => {
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'Tour Precio',
      name_en: 'Price Tour',
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

  // Solo adulto tiene precio activo (student/child no se venden en este tour).
  await admin
    .from('tour_pricing')
    .insert({ tour_id: tourId, ticket_type: 'adult', price_usd: ADULT_PRICE_USD });

  const { data: sched } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 1, start_time: '08:00', capacity: 10 })
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
      capacity_total: 10,
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
  for (const b of bks ?? []) await admin.from('payments').delete().eq('booking_id', b.id);
  await admin.from('bookings').delete().eq('tour_instance_id', instanceId);
  await admin.from('tour_holds').delete().eq('tour_instance_id', instanceId);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tour_pricing').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
});

describe('checkout — precio autoritativo (spec 0015)', () => {
  it('cobra el precio de la DB (booking y payment), no uno provisto por el cliente', async () => {
    const result = await initCheckout({
      instanceId,
      sessionToken: crypto.randomUUID(),
      customerName: 'Price Test',
      customerEmail: `pt-${crypto.randomUUID().slice(0, 8)}@example.com`,
      quantities: { adult: 2, child: 0, student: 0 },
      locale: 'es',
      consentAccepted: true,
    });

    const { data: booking } = await admin
      .from('bookings')
      .select('total_amount_cents')
      .eq('id', result.bookingId)
      .single();
    const { data: payment } = await admin
      .from('payments')
      .select('amount_cents')
      .eq('booking_id', result.bookingId)
      .single();

    expect(booking!.total_amount_cents).toBe(ADULT_PRICE_CENTS * 2);
    expect(payment!.amount_cents).toBe(ADULT_PRICE_CENTS * 2);
  });

  it('rechaza un tipo de ticket sin precio activo, sin crear booking ni payment', async () => {
    const email = `st-${crypto.randomUUID().slice(0, 8)}@example.com`;

    await expect(
      initCheckout({
        instanceId,
        sessionToken: crypto.randomUUID(),
        customerName: 'Student Test',
        customerEmail: email,
        quantities: { adult: 0, child: 0, student: 1 },
        locale: 'es',
        consentAccepted: true,
      }),
    ).rejects.toThrow();

    const { data: bks } = await admin.from('bookings').select('id').eq('customer_email', email);
    expect(bks ?? []).toHaveLength(0);
  });

  it('rechaza una instancia inexistente sin crear nada', async () => {
    const email = `gh-${crypto.randomUUID().slice(0, 8)}@example.com`;

    await expect(
      initCheckout({
        instanceId: crypto.randomUUID(),
        sessionToken: crypto.randomUUID(),
        customerName: 'Ghost',
        customerEmail: email,
        quantities: { adult: 1, child: 0, student: 0 },
        locale: 'es',
        consentAccepted: true,
      }),
    ).rejects.toThrow();

    const { data: bks } = await admin.from('bookings').select('id').eq('customer_email', email);
    expect(bks ?? []).toHaveLength(0);
  });
});
