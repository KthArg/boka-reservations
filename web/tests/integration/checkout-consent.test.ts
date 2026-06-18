// Persistencia del consentimiento (spec 0021, P1-3). Verifica que initCheckout registra
// consent_at + consent_version cuando el turista consintió, y los deja en NULL cuando no.
// Mockea el provider de pago; usa el service client real contra la DB. Requiere: supabase start.
// Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import { PRIVACY_NOTICE_VERSION } from '@shared/constants/legal';

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
const ADULT_PRICE_USD = 40;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
const TEST_SLUG = `checkout-consent-${crypto.randomUUID().slice(0, 8)}`;
let tourId: string;
let instanceId: string;

beforeAll(async () => {
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'Tour Consent',
      name_en: 'Consent Tour',
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

describe('checkout — consentimiento (spec 0021, P1-3)', () => {
  it('registra consent_at y consent_version cuando el turista consintió', async () => {
    const before = Date.now();
    const result = await initCheckout({
      instanceId,
      sessionToken: crypto.randomUUID(),
      customerName: 'Consent Yes',
      customerEmail: `cy-${crypto.randomUUID().slice(0, 8)}@example.com`,
      quantities: { adult: 1, child: 0, student: 0 },
      locale: 'es',
      consentAccepted: true,
    });

    const { data: booking } = await admin
      .from('bookings')
      .select('consent_at, consent_version')
      .eq('id', result.bookingId)
      .single();

    expect(booking!.consent_at).not.toBeNull();
    expect(new Date(booking!.consent_at!).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(booking!.consent_version).toBe(PRIVACY_NOTICE_VERSION);
  });

  it('deja consent_at y consent_version en NULL cuando no hubo consentimiento', async () => {
    const result = await initCheckout({
      instanceId,
      sessionToken: crypto.randomUUID(),
      customerName: 'Consent No',
      customerEmail: `cn-${crypto.randomUUID().slice(0, 8)}@example.com`,
      quantities: { adult: 1, child: 0, student: 0 },
      locale: 'es',
      consentAccepted: false,
    });

    const { data: booking } = await admin
      .from('bookings')
      .select('consent_at, consent_version')
      .eq('id', result.bookingId)
      .single();

    expect(booking!.consent_at).toBeNull();
    expect(booking!.consent_version).toBeNull();
  });
});
