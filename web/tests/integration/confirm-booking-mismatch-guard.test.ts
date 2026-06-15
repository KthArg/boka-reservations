// Guard de payment_mismatch DENTRO de confirm_booking (spec 0026, ítem 2 — defensa en
// profundidad de 0014). confirm_booking recibe el monto/moneda pagados; si no coinciden con
// payments.amount_cents/currency, NO confirma: deja la reserva en payment_mismatch (pago intacto
// en `pending`) + audit booking.payment_mismatch, idempotente. Orden interno: idempotencia →
// mismatch → capacidad → confirmar. Requiere: supabase start. Ejecutar: pnpm test:integration
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TEST_SLUG = `pay-mismatch-guard-${crypto.randomUUID().slice(0, 8)}`;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
const EXPECTED_CENTS = 7000;
const instanceIds: string[] = [];
let tourId: string;
let scheduleId: string;

async function createInstance(capacityTotal: number): Promise<string> {
  const startsAt = new Date(Date.now() + TWENTY_FIVE_HOURS_MS).toISOString();
  const { data } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: startsAt,
      ends_at: startsAt,
      capacity_total: capacityTotal,
    })
    .select('id')
    .single();
  instanceIds.push(data!.id);
  return data!.id;
}

async function seedBooking(
  instanceId: string,
  currency = 'USD',
): Promise<{ bookingId: string; externalPaymentId: string }> {
  const externalPaymentId = `pi_${crypto.randomUUID()}`;
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      customer_name: 'Mismatch Guard Test',
      customer_email: `mg-${crypto.randomUUID().slice(0, 8)}@example.com`,
      tickets_adult: 1,
      total_amount_cents: EXPECTED_CENTS,
      currency,
      locale: 'es',
    })
    .select('id')
    .single();
  await admin.from('payments').insert({
    booking_id: booking!.id,
    external_payment_id: externalPaymentId,
    amount_cents: EXPECTED_CENTS,
    currency,
  });
  return { bookingId: booking!.id, externalPaymentId };
}

async function confirm(
  bookingId: string,
  externalPaymentId: string,
  paid?: { amountCents: number; currency: string },
): Promise<void> {
  const { error } = await admin.rpc('confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
    p_total_seats: 1,
    ...(paid ? { p_paid_amount_cents: paid.amountCents, p_paid_currency: paid.currency } : {}),
  });
  if (error) throw new Error(`confirm_booking: ${error.message}`);
}

async function bookingStatus(bookingId: string): Promise<string> {
  const { data } = await admin.from('bookings').select('status').eq('id', bookingId).single();
  return data!.status;
}

async function paymentStatus(bookingId: string): Promise<string> {
  const { data } = await admin
    .from('payments')
    .select('status')
    .eq('booking_id', bookingId)
    .single();
  return data!.status;
}

async function reserved(instanceId: string): Promise<number> {
  const { data } = await admin
    .from('tour_instances')
    .select('capacity_reserved')
    .eq('id', instanceId)
    .single();
  return data!.capacity_reserved;
}

async function mismatchAuditCount(bookingId: string): Promise<number> {
  const { count } = await admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('entity_id', bookingId)
    .eq('action', 'booking.payment_mismatch');
  return count ?? 0;
}

async function mismatchAuditSource(bookingId: string): Promise<string | null> {
  const { data } = await admin
    .from('audit_logs')
    .select('metadata')
    .eq('entity_id', bookingId)
    .eq('action', 'booking.payment_mismatch')
    .single();
  return (data?.metadata as { source?: string } | null)?.source ?? null;
}

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
  scheduleId = sched!.id;
});

afterAll(async () => {
  const { data: bks } = await admin
    .from('bookings')
    .select('id')
    .in('tour_instance_id', instanceIds);
  for (const b of bks ?? []) {
    await admin.from('notifications').delete().eq('booking_id', b.id);
    await admin.from('payments').delete().eq('booking_id', b.id);
  }
  await admin.from('bookings').delete().in('tour_instance_id', instanceIds);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
});

describe('confirm_booking — guard de payment_mismatch (spec 0026)', () => {
  it('monto coincidente: confirma normal (camino feliz con los params nuevos)', async () => {
    const instanceId = await createInstance(5);
    const { bookingId, externalPaymentId } = await seedBooking(instanceId);

    await confirm(bookingId, externalPaymentId, { amountCents: EXPECTED_CENTS, currency: 'USD' });

    expect(await bookingStatus(bookingId)).toBe('confirmed');
    expect(await paymentStatus(bookingId)).toBe('succeeded');
    expect(await reserved(instanceId)).toBe(1);
    expect(await mismatchAuditCount(bookingId)).toBe(0);
  });

  it('monto distinto: NO confirma, queda payment_mismatch, pago pending, audita, no toca cupo', async () => {
    const instanceId = await createInstance(5);
    const { bookingId, externalPaymentId } = await seedBooking(instanceId);

    await confirm(bookingId, externalPaymentId, {
      amountCents: EXPECTED_CENTS - 100,
      currency: 'USD',
    });

    expect(await bookingStatus(bookingId)).toBe('payment_mismatch');
    expect(await paymentStatus(bookingId)).toBe('pending'); // el pago NO se da por bueno
    expect(await reserved(instanceId)).toBe(0); // no entrega cupo
    expect(await mismatchAuditCount(bookingId)).toBe(1);
    // El audit lo emitió el guard interno, no flag_payment_mismatch (ambos usan la misma action).
    expect(await mismatchAuditSource(bookingId)).toBe('confirm_booking');
  });

  it('moneda en otra capitalización (usd vs USD): NO marca falso-mismatch, confirma', async () => {
    const instanceId = await createInstance(5);
    const { bookingId, externalPaymentId } = await seedBooking(instanceId, 'USD');

    await confirm(bookingId, externalPaymentId, { amountCents: EXPECTED_CENTS, currency: 'usd' });

    expect(await bookingStatus(bookingId)).toBe('confirmed');
    expect(await mismatchAuditCount(bookingId)).toBe(0);
  });

  it('moneda realmente distinta (CRC vs USD): marca payment_mismatch', async () => {
    const instanceId = await createInstance(5);
    const { bookingId, externalPaymentId } = await seedBooking(instanceId, 'USD');

    await confirm(bookingId, externalPaymentId, { amountCents: EXPECTED_CENTS, currency: 'CRC' });

    expect(await bookingStatus(bookingId)).toBe('payment_mismatch');
    expect(await mismatchAuditCount(bookingId)).toBe(1);
  });

  it('idempotente: reintentar sobre una reserva ya payment_mismatch no re-audita ni confirma', async () => {
    const instanceId = await createInstance(5);
    const { bookingId, externalPaymentId } = await seedBooking(instanceId);

    await confirm(bookingId, externalPaymentId, {
      amountCents: EXPECTED_CENTS + 50,
      currency: 'USD',
    });
    await confirm(bookingId, externalPaymentId, {
      amountCents: EXPECTED_CENTS + 50,
      currency: 'USD',
    });

    expect(await bookingStatus(bookingId)).toBe('payment_mismatch');
    expect(await mismatchAuditCount(bookingId)).toBe(1); // no re-audita en el reintento
    expect(await reserved(instanceId)).toBe(0);
  });

  it('reconfirmar una reserva ya confirmed con monto incorrecto NO la marca mismatch (idempotencia va primero, spec §8)', async () => {
    const instanceId = await createInstance(5);
    const { bookingId, externalPaymentId } = await seedBooking(instanceId);

    await confirm(bookingId, externalPaymentId, { amountCents: EXPECTED_CENTS, currency: 'USD' });
    expect(await bookingStatus(bookingId)).toBe('confirmed');

    // Reintento con monto incorrecto: el gate por estado (idempotencia) retorna ANTES del guard
    // de mismatch, así que la reserva sigue confirmed, no se audita mismatch ni se duplica cupo.
    await confirm(bookingId, externalPaymentId, {
      amountCents: EXPECTED_CENTS - 100,
      currency: 'USD',
    });

    expect(await bookingStatus(bookingId)).toBe('confirmed');
    expect(await mismatchAuditCount(bookingId)).toBe(0);
    expect(await reserved(instanceId)).toBe(1); // no se duplica el cupo
  });

  it('sin monto (params omitidos): el guard no corre, confirma (comportamiento aditivo)', async () => {
    const instanceId = await createInstance(5);
    const { bookingId, externalPaymentId } = await seedBooking(instanceId);

    await confirm(bookingId, externalPaymentId); // sin p_paid_amount_cents / p_paid_currency

    expect(await bookingStatus(bookingId)).toBe('confirmed');
    expect(await mismatchAuditCount(bookingId)).toBe(0);
  });
});
