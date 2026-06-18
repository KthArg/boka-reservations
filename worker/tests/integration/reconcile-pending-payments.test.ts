// Job reconcile-pending-payments — integración contra DB real, con el cliente
// OnvoPay mockeado (servicio externo). Requiere: supabase start.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../web/types/database.js';
import { PaymentIntentOutcome } from '../../src/reconciliation/onvopay.js';

const onvoState = vi.hoisted(
  (): { outcome: string; rawStatus: string; amountCents?: number; currency?: string } => ({
    outcome: 'pending',
    rawStatus: 'processing',
    amountCents: undefined,
    currency: undefined,
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

vi.mock('../../src/reconciliation/onvopay.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/reconciliation/onvopay.js')>();
  return {
    ...actual,
    createOnvopayPaymentIntentClient: () => ({
      getPaymentIntent: () =>
        Promise.resolve({
          outcome: onvoState.outcome as PaymentIntentOutcome,
          rawStatus: onvoState.rawStatus,
          amountCents: onvoState.amountCents,
          currency: onvoState.currency,
        }),
    }),
  };
});

const { reconcilePendingPayments } = await import('../../src/jobs/reconcile-pending-payments.js');
const { cancelStaleBooking } = await import('../../src/reconciliation/repository.js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
// Justo bajo el umbral de 30 min (29m): aún no debe entrar al lote. El umbral bajó de 2h a
// 30 min en el spec 0025 (con la Capa 1, este umbral define la "ventana de pago" efectiva).
const JUST_UNDER_THRESHOLD_MS = 29 * 60 * 1000;
const TEST_SLUG = `reconcile-${crypto.randomUUID().slice(0, 8)}`;
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
  const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
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
    // audit_logs es append-only (trigger de inmutabilidad): no se borra.
    await admin.from('notifications').delete().eq('booking_id', b.id);
    await admin.from('payments').delete().eq('booking_id', b.id);
  }
  await admin.from('bookings').delete().eq('tour_instance_id', instanceId);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
});

async function seedPending(opts: { ageMs: number; withPayment: boolean }): Promise<{
  bookingId: string;
  externalPaymentId: string | null;
}> {
  const createdAt = new Date(Date.now() - opts.ageMs).toISOString();
  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instanceId,
      customer_name: 'Reconcile Test',
      customer_email: `rc-${crypto.randomUUID().slice(0, 8)}@example.com`,
      tickets_adult: 1,
      total_amount_cents: 5000,
      status: 'pending_payment',
      locale: 'es',
      created_at: createdAt,
    })
    .select('id')
    .single();

  let externalPaymentId: string | null = null;
  if (opts.withPayment) {
    externalPaymentId = `pi_${crypto.randomUUID()}`;
    await admin.from('payments').insert({
      booking_id: booking!.id,
      external_payment_id: externalPaymentId,
      amount_cents: 5000,
      status: 'pending',
    });
  }
  return { bookingId: booking!.id, externalPaymentId };
}

async function bookingStatus(id: string): Promise<string> {
  const { data } = await admin.from('bookings').select('status').eq('id', id).single();
  return data!.status;
}

async function reservedSeats(): Promise<number> {
  const { data } = await admin
    .from('tour_instances')
    .select('capacity_reserved')
    .eq('id', instanceId)
    .single();
  return data!.capacity_reserved;
}

describe('reconcilePendingPayments job (integración)', () => {
  it('reserva vencida sin pago: la cancela, audita y no toca el cupo', async () => {
    const before = await reservedSeats();
    const { bookingId } = await seedPending({ ageMs: THREE_HOURS_MS, withPayment: false });

    await reconcilePendingPayments();

    expect(await bookingStatus(bookingId)).toBe('cancelled');
    expect(await reservedSeats()).toBe(before); // cupo intacto

    const { data: audits } = await admin
      .from('audit_logs')
      .select('action')
      .eq('entity_id', bookingId);
    expect((audits ?? []).map((a) => a.action)).toContain('booking.expired_pending');
  });

  it('pago succeeded con monto coincidente: recupera la reserva (confirma, cupo, email, audita)', async () => {
    onvoState.outcome = PaymentIntentOutcome.Paid;
    onvoState.rawStatus = 'succeeded';
    onvoState.amountCents = 5000; // = monto sembrado por seedPending
    onvoState.currency = 'USD';
    const before = await reservedSeats();
    const { bookingId } = await seedPending({ ageMs: THREE_HOURS_MS, withPayment: true });

    await reconcilePendingPayments();

    expect(await bookingStatus(bookingId)).toBe('confirmed');
    expect(await reservedSeats()).toBe(before + 1); // 1 ticket_adult

    const { count } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .eq('kind', 'booking_confirmation');
    expect(count).toBe(1);

    const { data: audits } = await admin
      .from('audit_logs')
      .select('action')
      .eq('entity_id', bookingId);
    expect((audits ?? []).map((a) => a.action)).toContain('booking.recovered_via_reconcile');
  });

  it('pago succeeded con monto DISTINTO: marca payment_mismatch, no confirma ni cuenta como ingreso', async () => {
    onvoState.outcome = PaymentIntentOutcome.Paid;
    onvoState.rawStatus = 'succeeded';
    onvoState.amountCents = 9999; // != 5000 sembrado
    onvoState.currency = 'USD';
    const before = await reservedSeats();
    const { bookingId } = await seedPending({ ageMs: THREE_HOURS_MS, withPayment: true });

    await reconcilePendingPayments();

    expect(await bookingStatus(bookingId)).toBe('payment_mismatch');
    expect(await reservedSeats()).toBe(before); // sin reservar cupo
    const { data: payment } = await admin
      .from('payments')
      .select('status')
      .eq('booking_id', bookingId)
      .single();
    expect(payment!.status).toBe('pending'); // no se cuenta como ingreso

    const { data: audits } = await admin
      .from('audit_logs')
      .select('action')
      .eq('entity_id', bookingId);
    expect((audits ?? []).map((a) => a.action)).toContain('booking.payment_mismatch');
  });

  it('pago canceled en OnvoPay: cancela la reserva y marca el pago failed', async () => {
    onvoState.outcome = PaymentIntentOutcome.NotPaid;
    onvoState.rawStatus = 'canceled';
    const { bookingId } = await seedPending({ ageMs: THREE_HOURS_MS, withPayment: true });

    await reconcilePendingPayments();

    expect(await bookingStatus(bookingId)).toBe('cancelled');
    const { data: payment } = await admin
      .from('payments')
      .select('status')
      .eq('booking_id', bookingId)
      .single();
    expect(payment!.status).toBe('failed');
  });

  it('pago processing en OnvoPay: deja la reserva intacta para un ciclo posterior', async () => {
    onvoState.outcome = PaymentIntentOutcome.Pending;
    onvoState.rawStatus = 'processing';
    const { bookingId } = await seedPending({ ageMs: THREE_HOURS_MS, withPayment: true });

    await reconcilePendingPayments();

    expect(await bookingStatus(bookingId)).toBe('pending_payment');
  });

  it('reserva reciente (< umbral): no entra al lote', async () => {
    const { bookingId } = await seedPending({ ageMs: 60 * 1000, withPayment: false });

    await reconcilePendingPayments();

    expect(await bookingStatus(bookingId)).toBe('pending_payment');
  });

  it('borde del umbral: una reserva a 29m (justo bajo 30 min) todavía no se procesa', async () => {
    const { bookingId } = await seedPending({
      ageMs: JUST_UNDER_THRESHOLD_MS,
      withPayment: false,
    });

    await reconcilePendingPayments();

    expect(await bookingStatus(bookingId)).toBe('pending_payment');
  });

  it('idempotente: cancel_stale_pending_booking sobre una reserva ya confirmada no la toca', async () => {
    onvoState.outcome = PaymentIntentOutcome.Paid;
    onvoState.rawStatus = 'succeeded';
    onvoState.amountCents = 5000; // coincide con lo sembrado → recupera
    onvoState.currency = 'USD';
    const { bookingId } = await seedPending({ ageMs: THREE_HOURS_MS, withPayment: true });
    await reconcilePendingPayments(); // queda confirmed
    expect(await bookingStatus(bookingId)).toBe('confirmed');

    const cancelled = await cancelStaleBooking(admin as never, bookingId, 'no_payment');

    expect(cancelled).toBe(false);
    expect(await bookingStatus(bookingId)).toBe('confirmed');
  });
});
