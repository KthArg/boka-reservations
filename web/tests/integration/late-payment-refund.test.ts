// Camino late_payment_refunded + asientos autoritativos + liberación de hold en
// mismatch (spec 0028). Mockea el provider (verifyWebhook) y Sentry; usa el service
// client real contra la DB. Requiere: supabase start. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const EXPECTED_CENTS = 5000;
const WRONG_CENTS = 9999;

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
const TEST_SLUG = `late-payment-${crypto.randomUUID().slice(0, 8)}`;
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
  for (const b of bks ?? []) {
    await admin.from('notifications').delete().eq('booking_id', b.id);
    await admin.from('refunds').delete().eq('booking_id', b.id);
    await admin.from('payments').delete().eq('booking_id', b.id);
  }
  await admin.from('bookings').delete().eq('tour_instance_id', instanceId);
  await admin.from('tour_holds').delete().eq('tour_instance_id', instanceId);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
  for (const id of eventIds) await admin.from('processed_webhook_events').delete().eq('id', id);
});

beforeEach(() => {
  providerState.payload = null;
});

type Seeded = { bookingId: string; externalPaymentId: string; holdId: string };

/** Reserva pending_payment con pago y hold `paying`, como deja el checkout real. */
async function seedBooking(tickets = { adult: 1, child: 0, student: 0 }): Promise<Seeded> {
  const externalPaymentId = `pi_${crypto.randomUUID()}`;
  const { data: hold } = await admin
    .from('tour_holds')
    .insert({
      tour_instance_id: instanceId,
      session_token: crypto.randomUUID(),
      held_seats: tickets.adult + tickets.child + tickets.student,
      status: 'paying',
    })
    .select('id')
    .single();
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      hold_id: hold!.id,
      customer_name: 'Late Test',
      customer_email: `lp-${crypto.randomUUID().slice(0, 8)}@example.com`,
      tickets_adult: tickets.adult,
      tickets_child: tickets.child,
      tickets_student: tickets.student,
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
  return { bookingId: booking!.id, externalPaymentId, holdId: hold!.id };
}

async function postWebhook(): Promise<Response> {
  const req = new NextRequest('http://localhost/api/webhooks/onvopay', {
    method: 'POST',
    body: JSON.stringify(providerState.payload),
    headers: { 'x-webhook-secret': 'mocked' },
  });
  return POST(req);
}

function payload(over: Partial<NonNullable<typeof providerState.payload>>) {
  const p = {
    eventType: 'payment-intent.succeeded',
    eventId: `evt_${crypto.randomUUID()}`,
    paymentId: 'pi_unset',
    amountCents: EXPECTED_CENTS,
    currency: 'USD',
    status: 'succeeded',
    ...over,
  };
  eventIds.push(p.eventId);
  return p;
}

async function bookingStatus(id: string): Promise<string> {
  const { data } = await admin.from('bookings').select('status').eq('id', id).single();
  return data!.status;
}

async function holdStatus(id: string): Promise<string> {
  const { data } = await admin.from('tour_holds').select('status').eq('id', id).single();
  return data!.status;
}

async function refundsOf(bookingId: string) {
  const { data } = await admin
    .from('refunds')
    .select('amount_cents, currency, reason, status')
    .eq('booking_id', bookingId);
  return data ?? [];
}

async function lateAuditCount(bookingId: string): Promise<number> {
  const { count } = await admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('entity_id', bookingId)
    .eq('action', 'booking.late_payment_refunded');
  return count ?? 0;
}

describe('pago tardío sobre reserva cancelada (spec 0028)', () => {
  it('encola refund total, marca el pago succeeded y audita; la reserva sigue cancelled', async () => {
    const { bookingId, externalPaymentId } = await seedBooking();
    // Cancelación por staleness, como la ejecuta el reconciliador a los 30 min.
    const { data: cancelled } = await admin.rpc('cancel_stale_pending_booking', {
      p_booking_id: bookingId,
      p_reason: 'requires_payment_method',
    });
    expect(cancelled).toBe(true);

    providerState.payload = payload({ paymentId: externalPaymentId });
    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(await bookingStatus(bookingId)).toBe('cancelled');
    const { data: pay } = await admin
      .from('payments')
      .select('status')
      .eq('external_payment_id', externalPaymentId)
      .single();
    expect(pay!.status).toBe('succeeded');
    const refunds = await refundsOf(bookingId);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      amount_cents: EXPECTED_CENTS,
      reason: 'late_payment',
      status: 'pending',
    });
    expect(await lateAuditCount(bookingId)).toBe(1);
  });

  it('reenvío del mismo evento: already_processed — sin refund ni audit duplicados', async () => {
    const { bookingId, externalPaymentId } = await seedBooking();
    await admin.rpc('cancel_stale_pending_booking', {
      p_booking_id: bookingId,
      p_reason: 'requires_payment_method',
    });
    providerState.payload = payload({ paymentId: externalPaymentId });

    const first = await postWebhook();
    const second = await postWebhook();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await refundsOf(bookingId)).toHaveLength(1);
    expect(await lateAuditCount(bookingId)).toBe(1);
  });

  it('dos entregas CONCURRENTES del mismo evento tardío: un solo refund', async () => {
    const { bookingId, externalPaymentId } = await seedBooking();
    await admin.rpc('cancel_stale_pending_booking', {
      p_booking_id: bookingId,
      p_reason: 'requires_payment_method',
    });
    providerState.payload = payload({ paymentId: externalPaymentId });

    const [a, b] = await Promise.all([postWebhook(), postWebhook()]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await refundsOf(bookingId)).toHaveLength(1);
  });

  it('pago tardío con monto INCORRECTO: no encola refund (ignored, revisión manual)', async () => {
    const { bookingId, externalPaymentId } = await seedBooking();
    await admin.rpc('cancel_stale_pending_booking', {
      p_booking_id: bookingId,
      p_reason: 'requires_payment_method',
    });

    // La validación del handler corta antes (flag no-op sobre cancelled) y responde 200;
    // la RPC nunca debe encolar un refund por un monto que no coincide.
    providerState.payload = payload({ paymentId: externalPaymentId, amountCents: WRONG_CENTS });
    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(await bookingStatus(bookingId)).toBe('cancelled');
    expect(await refundsOf(bookingId)).toHaveLength(0);
  });
});

describe('asientos autoritativos en confirm_booking (spec 0028)', () => {
  it('ignora un p_total_seats mentiroso: incrementa capacity_reserved por los tickets reales', async () => {
    const { bookingId, externalPaymentId } = await seedBooking({ adult: 2, child: 1, student: 0 });
    const { data: before } = await admin
      .from('tour_instances')
      .select('capacity_reserved')
      .eq('id', instanceId)
      .single();

    // p_total_seats = 0 era el modo de fallo del hallazgo (lectura fallida del handler).
    const { data: outcome, error } = await admin.rpc('confirm_booking', {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_total_seats: 0,
      p_paid_amount_cents: EXPECTED_CENTS,
      p_paid_currency: 'USD',
    });

    expect(error).toBeNull();
    expect(outcome).toBe('confirmed');
    const { data: after } = await admin
      .from('tour_instances')
      .select('capacity_reserved')
      .eq('id', instanceId)
      .single();
    expect(after!.capacity_reserved - before!.capacity_reserved).toBe(3);
    // Traza forense del camino feliz (spec 0028).
    const { count } = await admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', bookingId)
      .eq('action', 'booking.confirmed');
    expect(count).toBe(1);
  });
});

describe('payment_mismatch libera el hold paying (spec 0028)', () => {
  it('camino mismatch de confirm_booking: outcome payment_mismatch y hold released', async () => {
    const { bookingId, externalPaymentId, holdId } = await seedBooking();

    const { data: outcome } = await admin.rpc('confirm_booking', {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_paid_amount_cents: WRONG_CENTS,
      p_paid_currency: 'USD',
    });

    expect(outcome).toBe('payment_mismatch');
    expect(await bookingStatus(bookingId)).toBe('payment_mismatch');
    expect(await holdStatus(holdId)).toBe('released');
  });

  it('flag_payment_mismatch: también libera el hold', async () => {
    const { bookingId, holdId } = await seedBooking();

    const { data: flagged } = await admin.rpc('flag_payment_mismatch', {
      p_booking_id: bookingId,
      p_paid_amount_cents: WRONG_CENTS,
      p_paid_currency: 'USD',
      p_source: 'webhook',
    });

    expect(flagged).toBe(true);
    expect(await bookingStatus(bookingId)).toBe('payment_mismatch');
    expect(await holdStatus(holdId)).toBe('released');
  });
});
