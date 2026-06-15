// Prevención de sobreventa en confirm_booking (spec 0025). Reemplaza el comportamiento del
// 0023 (confirmaba igual + audit `booking.overbooked`): ahora, si confirmar superaría
// capacity_total, la reserva pasa al terminal `overbooked_refunded`, NO incrementa
// capacity_reserved, marca el pago succeeded, encola un refund TOTAL, audita
// `booking.overbooked_refunded` y notifica. Verifica el borde de capacidad, la idempotencia
// del camino del reconciliador (sin event_id) y la concurrencia por el último cupo.
// Requiere: supabase start. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TEST_SLUG = `overbook-${crypto.randomUUID().slice(0, 8)}`;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
const SEAT_PRICE_CENTS = 5000;
const instanceIds: string[] = [];
const eventIds: string[] = [];
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
  seats: number,
): Promise<{ bookingId: string; externalPaymentId: string }> {
  const externalPaymentId = `pi_${crypto.randomUUID()}`;
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      customer_name: 'Overbook Test',
      customer_email: `ob-${crypto.randomUUID().slice(0, 8)}@example.com`,
      tickets_adult: seats,
      total_amount_cents: SEAT_PRICE_CENTS,
      locale: 'es',
    })
    .select('id')
    .single();
  await admin.from('payments').insert({
    booking_id: booking!.id,
    external_payment_id: externalPaymentId,
    amount_cents: SEAT_PRICE_CENTS,
  });
  return { bookingId: booking!.id, externalPaymentId };
}

async function confirm(
  bookingId: string,
  externalPaymentId: string,
  seats: number,
): Promise<string> {
  const eventId = `evt_ob_${crypto.randomUUID()}`;
  eventIds.push(eventId);
  const { error } = await admin.rpc('confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
    p_total_seats: seats,
    p_event_id: eventId,
  });
  if (error) throw new Error(`confirm_booking: ${error.message}`);
  return eventId;
}

/** Camino del reconciliador: confirm_booking SIN event_id (la idempotencia recae solo en el
 * guard por estado del booking, no en processed_webhook_events). */
async function confirmNoEvent(
  bookingId: string,
  externalPaymentId: string,
  seats: number,
): Promise<void> {
  const { error } = await admin.rpc('confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
    p_total_seats: seats,
  });
  if (error) throw new Error(`confirm (no event): ${error.message}`);
}

async function reserved(instanceId: string): Promise<number> {
  const { data } = await admin
    .from('tour_instances')
    .select('capacity_reserved')
    .eq('id', instanceId)
    .single();
  return data!.capacity_reserved;
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

async function overbookedAuditCount(bookingId: string): Promise<number> {
  const { count } = await admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('entity_id', bookingId)
    .eq('action', 'booking.overbooked_refunded');
  return count ?? 0;
}

async function refunds(
  bookingId: string,
): Promise<{ amount_cents: number; reason: string | null }[]> {
  const { data } = await admin
    .from('refunds')
    .select('amount_cents, reason')
    .eq('booking_id', bookingId);
  return data ?? [];
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
    await admin.from('refunds').delete().eq('booking_id', b.id);
    await admin.from('payments').delete().eq('booking_id', b.id);
  }
  await admin.from('bookings').delete().in('tour_instance_id', instanceIds);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
  for (const id of eventIds) await admin.from('processed_webhook_events').delete().eq('id', id);
});

describe('confirm_booking — prevención de sobreventa (spec 0025)', () => {
  it('confirmar justo HASTA capacity_total confirma sin sobreventa', async () => {
    const instanceId = await createInstance(2);
    const { bookingId, externalPaymentId } = await seedBooking(instanceId, 2);

    await confirm(bookingId, externalPaymentId, 2); // 0 + 2 == 2, hay cupo

    expect(await reserved(instanceId)).toBe(2);
    expect(await bookingStatus(bookingId)).toBe('confirmed');
    expect(await overbookedAuditCount(bookingId)).toBe(0);
    expect(await refunds(bookingId)).toHaveLength(0);
  });

  it('el pago que excede el cupo NO confirma: overbooked_refunded + refund total, idempotente', async () => {
    const instanceId = await createInstance(1);
    const a = await seedBooking(instanceId, 1);
    const b = await seedBooking(instanceId, 1);

    await confirm(a.bookingId, a.externalPaymentId, 1); // 0 + 1 == 1, confirma
    expect(await bookingStatus(a.bookingId)).toBe('confirmed');
    expect(await reserved(instanceId)).toBe(1);

    await confirm(b.bookingId, b.externalPaymentId, 1); // 1 + 1 > 1, sobreventa

    expect(await bookingStatus(b.bookingId)).toBe('overbooked_refunded');
    expect(await reserved(instanceId)).toBe(1); // NO se incrementa: el asiento no se entrega
    expect(await paymentStatus(b.bookingId)).toBe('succeeded'); // el turista pagó
    expect(await overbookedAuditCount(b.bookingId)).toBe(1);
    const r = await refunds(b.bookingId);
    expect(r).toHaveLength(1);
    expect(r[0].amount_cents).toBe(SEAT_PRICE_CENTS); // refund TOTAL
    expect(r[0].reason).toBe('overbooked_refunded');

    // Idempotencia del camino del reconciliador (sin event_id): no debe encolar un 2º refund.
    await confirmNoEvent(b.bookingId, b.externalPaymentId, 1);
    expect(await bookingStatus(b.bookingId)).toBe('overbooked_refunded');
    expect(await reserved(instanceId)).toBe(1);
    expect(await refunds(b.bookingId)).toHaveLength(1);
    expect(await overbookedAuditCount(b.bookingId)).toBe(1);
  });

  it('dos pagos concurrentes por el último cupo: exactamente uno confirma, el otro se auto-reembolsa', async () => {
    const instanceId = await createInstance(1);
    const a = await seedBooking(instanceId, 1);
    const b = await seedBooking(instanceId, 1);

    await Promise.all([
      confirm(a.bookingId, a.externalPaymentId, 1),
      confirm(b.bookingId, b.externalPaymentId, 1),
    ]);

    const statuses = [await bookingStatus(a.bookingId), await bookingStatus(b.bookingId)].sort();
    expect(statuses).toEqual(['confirmed', 'overbooked_refunded']);
    expect(await reserved(instanceId)).toBe(1); // invariante: nunca supera capacity_total

    // El que quedó overbooked_refunded tiene un refund total encolado.
    const overbookedId =
      (await bookingStatus(a.bookingId)) === 'overbooked_refunded' ? a.bookingId : b.bookingId;
    const r = await refunds(overbookedId);
    expect(r).toHaveLength(1);
    expect(r[0].amount_cents).toBe(SEAT_PRICE_CENTS);
  });

  // Capa 1: el hold queda `paying` durante el pago; si la reserva se abandona, la
  // reconciliación (cancel_stale_pending_booking) debe liberar ese hold para no atar el cupo.
  it('cancel_stale_pending_booking libera el hold paying de una reserva abandonada', async () => {
    const instanceId = await createInstance(1);
    const { data: hold } = await admin
      .from('tour_holds')
      .insert({
        tour_instance_id: instanceId,
        session_token: `sess-${crypto.randomUUID().slice(0, 8)}`,
        held_seats: 1,
        status: 'paying',
      })
      .select('id')
      .single();
    const { data: booking } = await admin
      .from('bookings')
      .insert({
        tour_instance_id: instanceId,
        hold_id: hold!.id,
        customer_name: 'Abandono',
        customer_email: `ab-${crypto.randomUUID().slice(0, 8)}@example.com`,
        tickets_adult: 1,
        total_amount_cents: SEAT_PRICE_CENTS,
        locale: 'es',
      })
      .select('id')
      .single();

    const { error } = await admin.rpc('cancel_stale_pending_booking', {
      p_booking_id: booking!.id,
      p_reason: 'no_payment',
    });
    expect(error).toBeNull();

    expect(await bookingStatus(booking!.id)).toBe('cancelled');
    const { data: h } = await admin.from('tour_holds').select('status').eq('id', hold!.id).single();
    expect(h!.status).toBe('expired'); // el hold paying se liberó, no quedó atado
  });
});
