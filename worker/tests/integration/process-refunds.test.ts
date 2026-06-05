// Job process-refunds — integración contra DB real, con el cliente OnvoPay
// mockeado (servicio externo). Requiere: supabase start.
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../web/types/database.js';

const onvoState = vi.hoisted(
  (): { status: 'succeeded' | 'failed'; failureReason: string | undefined } => ({
    status: 'succeeded',
    failureReason: undefined,
  }),
);

vi.mock('../../src/env.js', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    ONVOPAY_SECRET_KEY: 'onvo_test_integration',
    APP_URL: 'http://localhost:3000',
  },
}));

vi.mock('../../src/refunds/onvopay.js', () => ({
  createOnvopayRefundClient: () => ({
    createRefund: () =>
      Promise.resolve({
        externalRefundId: `ext_ref_${crypto.randomUUID()}`,
        status: onvoState.status,
        failureReason: onvoState.failureReason,
      }),
    getRefund: () => Promise.resolve({ externalRefundId: 'x', status: onvoState.status }),
  }),
}));

const { processRefunds } = await import('../../src/jobs/process-refunds.js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TEST_SLUG = `refund-job-${crypto.randomUUID().slice(0, 8)}`;
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
  const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
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
    await admin.from('audit_logs').delete().eq('entity_id', b.id);
    await admin.from('refunds').delete().eq('booking_id', b.id);
    await admin.from('notifications').delete().eq('booking_id', b.id);
    await admin.from('payments').delete().eq('booking_id', b.id);
  }
  await admin.from('bookings').delete().eq('tour_instance_id', instanceId);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
});

afterEach(() => {
  onvoState.status = 'succeeded';
  onvoState.failureReason = undefined;
});

async function seedRefund(): Promise<{ bookingId: string; refundId: string }> {
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      customer_name: 'Refund Test',
      customer_email: `r-${crypto.randomUUID().slice(0, 8)}@example.com`,
      tickets_adult: 1,
      total_amount_cents: 7000,
      status: 'cancelled',
      locale: 'es',
    })
    .select('id')
    .single();
  const { data: payment } = await admin
    .from('payments')
    .insert({
      booking_id: booking!.id,
      external_payment_id: `pi_${crypto.randomUUID()}`,
      amount_cents: 7000,
      status: 'succeeded',
    })
    .select('id')
    .single();
  const { data: refund } = await admin
    .from('refunds')
    .insert({ booking_id: booking!.id, payment_id: payment!.id, amount_cents: 7000 })
    .select('id')
    .single();
  return { bookingId: booking!.id, refundId: refund!.id };
}

describe('processRefunds job (integración)', () => {
  it('acredita el refund: marca refunded, encola el email y audita', async () => {
    const { bookingId, refundId } = await seedRefund();

    await processRefunds();

    const { data: refund } = await admin
      .from('refunds')
      .select('status')
      .eq('id', refundId)
      .single();
    expect(refund!.status).toBe('succeeded');

    const { data: payment } = await admin
      .from('payments')
      .select('status')
      .eq('booking_id', bookingId)
      .single();
    expect(payment!.status).toBe('refunded');

    const { data: booking } = await admin
      .from('bookings')
      .select('status')
      .eq('id', bookingId)
      .single();
    expect(booking!.status).toBe('refunded');

    const { count } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .eq('kind', 'refund_confirmation');
    expect(count).toBe(1);

    const { data: audits } = await admin
      .from('audit_logs')
      .select('action')
      .eq('entity_id', bookingId);
    expect((audits ?? []).map((a) => a.action)).toContain('refund.succeeded');
  });

  it('si OnvoPay falla, deja el refund failed y el booking cancelled', async () => {
    onvoState.status = 'failed';
    onvoState.failureReason = 'card_declined';
    const { bookingId, refundId } = await seedRefund();

    await processRefunds();

    const { data: refund } = await admin
      .from('refunds')
      .select('status, failure_reason')
      .eq('id', refundId)
      .single();
    expect(refund!.status).toBe('failed');
    expect(refund!.failure_reason).toBe('card_declined');

    const { data: booking } = await admin
      .from('bookings')
      .select('status')
      .eq('id', bookingId)
      .single();
    expect(booking!.status).toBe('cancelled');
  });
});
