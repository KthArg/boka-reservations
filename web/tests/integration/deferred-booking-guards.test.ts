// Guardas del pipeline de dinero vigente frente al flujo diferido (spec 0029 §5.3, §5.4, §5.6 y
// §6; migración …044): confirm_booking (gate positivo, confirmed_unclaimed, doble cobro, refund
// bloqueado, avisos y recordatorio), el gate del reconciliador, flag_payment_mismatch y las
// exclusiones de retención, llamadas directo sin mocks del caller. Incluye la regresión del
// checkout con widget.
// Excede 150 líneas: excepción de testing-practices (lógica de dinero con muchos casos).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';
import {
  ageFailedPayments,
  auditEntries,
  cancelledWithUnclosedIntent,
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  failCharge,
  HOUR_MS,
  MANDATE_CENTS,
  MANDATE_CURRENCY,
  must,
  notificationKinds,
  notificationStatus,
  ok,
  paymentsOf,
  readBooking,
  readHoldStatus,
  startCharge,
  uid,
  userIdByEmail,
  type Db,
} from './deferred-fixtures';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

// Retención: fechas muy viejas para que el corte no alcance datos de otras suites.
const AGED_CREATED_AT = '2020-01-01T00:00:00Z';
const RETENTION_CUTOFF = '2021-01-01T00:00:00Z';

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tourIds: string[] = [];
let roomyInstanceId: string;
let soonInstanceId: string;
let staffId: string;
let adminId: string;

function confirm(bookingId: string, intent: string) {
  return db.rpc('confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: intent,
    p_paid_amount_cents: MANDATE_CENTS,
    p_paid_currency: MANDATE_CURRENCY,
  });
}

/** Reserva del checkout con widget (flujo vigente): pending_payment, pago y hold `paying`. */
async function createWidgetBooking(
  instanceId: string,
  status: 'pending_payment' | 'cancelled' = 'pending_payment',
  paymentStatus: 'pending' | 'failed' = 'pending',
): Promise<{ bookingId: string; intent: string }> {
  const hold = must(
    await db
      .from('tour_holds')
      .insert({
        tour_instance_id: instanceId,
        session_token: crypto.randomUUID(),
        held_seats: 1,
        status: 'paying',
      })
      .select('id')
      .single(),
    'hold',
  );
  const booking = must(
    await db
      .from('bookings')
      .insert({
        tour_instance_id: instanceId,
        hold_id: hold.id,
        customer_name: 'Widget',
        customer_email: `widget-${uid()}@example.com`,
        tickets_adult: 1,
        total_amount_cents: MANDATE_CENTS,
        status,
      })
      .select('id')
      .single(),
    'booking',
  );
  const intent = `pi_${crypto.randomUUID()}`;
  ok(
    await db.from('payments').insert({
      booking_id: booking.id,
      external_payment_id: intent,
      amount_cents: MANDATE_CENTS,
      status: paymentStatus,
    }),
    'payment',
  );
  return { bookingId: booking.id, intent };
}

async function capacityReserved(instanceId: string): Promise<number> {
  return must(
    await db.from('tour_instances').select('capacity_reserved').eq('id', instanceId).single(),
    'capacityReserved',
  ).capacity_reserved;
}

async function bookingExists(bookingId: string): Promise<boolean> {
  const { count } = await db
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('id', bookingId);
  return count === 1;
}

beforeAll(async () => {
  const roomy = await createDeparture(db, 10 * DAY_MS);
  const soon = await createDeparture(db, 10 * HOUR_MS);
  tourIds.push(roomy.tourId, soon.tourId);
  roomyInstanceId = roomy.instanceId;
  soonInstanceId = soon.instanceId;
  [staffId, adminId] = await Promise.all([
    userIdByEmail(db, 'staff@bokatrails.com'),
    userIdByEmail(db, 'admin@bokatrails.com'),
  ]);
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

describe('confirm_booking — flujo diferido', () => {
  it('confirms a deferred booking whose charge was started', async () => {
    // Arrange
    const { bookingId, hold } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);
    const capacityBefore = await capacityReserved(roomyInstanceId);

    // Act
    const outcome = must(await confirm(bookingId, intent), 'rpc');

    // Assert
    expect(outcome).toBe('confirmed');
    expect((await readBooking(db, bookingId)).status).toBe('confirmed');
    expect(await readHoldStatus(db, hold.holdId)).toBe('converted');
    expect(await capacityReserved(roomyInstanceId)).toBe(capacityBefore + 2);
    expect(await notificationKinds(db, bookingId)).toEqual([
      'booking_confirmation',
      'booking_reserved',
      'reminder_24h',
    ]);
  });

  it('confirms a charge that settled after a recorded decline, and cancels the stale notice', async () => {
    // Arrange: el rechazo se registró, pero el intent re-confirmable terminó liquidando.
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);
    await failCharge(db, bookingId, intent);

    // Act
    const outcome = must(await confirm(bookingId, intent), 'rpc');

    // Assert
    expect(outcome).toBe('confirmed');
    const notice = await notificationStatus(db, bookingId, 'charge_failed_action_required_1');
    expect(notice).toMatchObject({ status: 'cancelled', cancelled_reason: 'booking_confirmed' });
  });

  it('confirms but flags a deferred booking that never started a charge', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = `pi_${crypto.randomUUID()}`;
    ok(
      await db.from('payments').insert({
        booking_id: bookingId,
        external_payment_id: intent,
        amount_cents: MANDATE_CENTS,
      }),
      'payment',
    );

    // Act
    const outcome = must(await confirm(bookingId, intent), 'rpc');

    // Assert
    expect(outcome).toBe('confirmed_unclaimed');
    const audits = await auditEntries(db, bookingId, 'booking.confirmed');
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    expect(audit.metadata).toMatchObject({ unclaimed: true, deferred: true });
  });

  it('does not confirm a deferred booking without a pending payment for that intent', async () => {
    // Arrange: sin fila, y con la fila de un intent registrado como cerrado.
    const { bookingId: withoutRow } = await createDeferredBooking(db, roomyInstanceId);
    const { bookingId: closedRow } = await createDeferredBooking(db, roomyInstanceId);
    const closedIntent = await startCharge(db, closedRow);
    await failCharge(db, closedRow, closedIntent, true);

    // Act
    const outcomes = [
      must(await confirm(withoutRow, `pi_${crypto.randomUUID()}`), 'without row'),
      must(await confirm(closedRow, closedIntent), 'closed row'),
    ];

    // Assert
    expect(outcomes).toEqual(['ignored', 'ignored']);
    expect((await readBooking(db, closedRow)).status).toBe('pending_minimum');
  });

  it('reports a second intent that settles on a confirmed booking as a duplicate payment', async () => {
    // Arrange: A se registró como cerrado, B cobró y confirmó; después A liquida igual.
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const first = await startCharge(db, bookingId);
    await failCharge(db, bookingId, first, true);
    const second = await startCharge(db, bookingId);
    must(await confirm(bookingId, second), 'confirm second');

    // Act
    const outcome = must(await confirm(bookingId, first), 'rpc');

    // Assert
    expect(outcome).toBe('duplicate_payment');
    expect((await paymentsOf(db, bookingId)).map((p) => p.status)).toEqual([
      'succeeded',
      'succeeded',
    ]);
    const audits = await auditEntries(db, bookingId, 'booking.duplicate_payment');
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    expect(audit.metadata).toMatchObject({ external_payment_id: first });
  });

  it('reports a late payment whose refund could not be enqueued', async () => {
    // Arrange: reserva cancelada que ya tiene un refund activo.
    const { bookingId, intent } = await cancelledWithUnclosedIntent(db, roomyInstanceId);
    const [payment] = await paymentsOf(db, bookingId);
    ok(
      await db.from('refunds').insert({
        booking_id: bookingId,
        payment_id: payment.id,
        amount_cents: MANDATE_CENTS,
        currency: MANDATE_CURRENCY,
        reason: 'test',
      }),
      'refund',
    );

    // Act
    const outcome = must(await confirm(bookingId, intent), 'rpc');

    // Assert
    expect(outcome).toBe('late_payment_refund_blocked');
    expect(await auditEntries(db, bookingId, 'booking.late_payment_refunded')).toEqual([]);
    expect(await auditEntries(db, bookingId, 'booking.late_payment_refund_blocked')).toHaveLength(
      1,
    );
  });

  it('skips the 24h reminder when the departure is less than a day away', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, soonInstanceId);
    const intent = await startCharge(db, bookingId);

    // Act
    must(await confirm(bookingId, intent), 'rpc');

    // Assert
    expect(await notificationKinds(db, bookingId)).toEqual([
      'booking_confirmation',
      'booking_reserved',
    ]);
  });

  it('still confirms a widget checkout exactly as before', async () => {
    // Arrange
    const { bookingId, intent } = await createWidgetBooking(roomyInstanceId);

    // Act
    const outcome = must(await confirm(bookingId, intent), 'rpc');

    // Assert
    expect(outcome).toBe('confirmed');
    expect((await readBooking(db, bookingId)).status).toBe('confirmed');
  });
});

describe('cancel_stale_pending_booking — gate del reconciliador', () => {
  it('leaves a deferred charge in flight to the charge worker', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    await startCharge(db, bookingId);

    // Act
    const cancelled = must(
      await db.rpc('cancel_stale_pending_booking', { p_booking_id: bookingId, p_reason: 'stale' }),
      'rpc',
    );

    // Assert
    expect(cancelled).toBe(false);
    expect((await readBooking(db, bookingId)).status).toBe('pending_payment');
  });

  it('still cancels an abandoned widget checkout', async () => {
    // Arrange
    const { bookingId } = await createWidgetBooking(roomyInstanceId);

    // Act
    const cancelled = must(
      await db.rpc('cancel_stale_pending_booking', { p_booking_id: bookingId, p_reason: 'stale' }),
      'rpc',
    );

    // Assert
    expect(cancelled).toBe(true);
    expect((await readBooking(db, bookingId)).status).toBe('cancelled');
  });
});

describe('flag_payment_mismatch', () => {
  it('flags a pending_minimum booking and releases its hold', async () => {
    // Arrange
    const { bookingId, hold } = await createDeferredBooking(db, roomyInstanceId);

    // Act
    const flagged = must(
      await db.rpc('flag_payment_mismatch', {
        p_booking_id: bookingId,
        p_paid_amount_cents: 1,
        p_paid_currency: MANDATE_CURRENCY,
        p_source: 'test',
      }),
      'rpc',
    );

    // Assert
    expect(flagged).toBe(true);
    expect((await readBooking(db, bookingId)).status).toBe('payment_mismatch');
    expect(await readHoldStatus(db, hold.holdId)).toBe('released');
  });
});

describe('retención — reservas vivas e intents abiertos', () => {
  async function age(bookingId: string): Promise<void> {
    ok(
      await db.from('bookings').update({ created_at: AGED_CREATED_AT }).eq('id', bookingId),
      'age',
    );
  }

  it('purge_unpaid_bookings keeps live deferred bookings and intents that may still settle', async () => {
    // Arrange
    const { bookingId: live } = await createDeferredBooking(db, roomyInstanceId);
    const { bookingId: unclosed } = await cancelledWithUnclosedIntent(db, roomyInstanceId);
    const { bookingId: closed } = await cancelledWithUnclosedIntent(db, roomyInstanceId);
    await ageFailedPayments(db, closed);
    const [closedPayment] = await paymentsOf(db, closed);
    must(
      await db.rpc('mark_payment_provider_closed', {
        p_payment_id: closedPayment.id,
        p_actor_id: staffId,
      }),
      'close',
    );
    const { bookingId: widget } = await createWidgetBooking(roomyInstanceId, 'cancelled', 'failed');
    // Widget con el intent todavía `pending`: podría liquidar, se conserva (spec 0029 §6).
    const { bookingId: widgetPending } = await createWidgetBooking(roomyInstanceId);
    for (const id of [live, unclosed, closed, widget, widgetPending]) await age(id);

    // Act
    must(await db.rpc('purge_unpaid_bookings', { p_cutoff: RETENTION_CUTOFF }), 'rpc');

    // Assert
    expect({
      live: await bookingExists(live),
      unclosed: await bookingExists(unclosed),
      closed: await bookingExists(closed),
      widget: await bookingExists(widget),
      widgetPending: await bookingExists(widgetPending),
    }).toEqual({ live: true, unclosed: true, closed: false, widget: false, widgetPending: true });
  });

  it('anonymize_booking_pii_by_email keeps a live deferred booking and reports it as retained', async () => {
    // Arrange
    const email = `baja-${uid()}@example.com`;
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId, {
      p_customer_email: email,
    });

    // Act
    const [result] = must(
      await db.rpc('anonymize_booking_pii_by_email', { p_email: email, p_actor_id: adminId }),
      'rpc',
    );

    // Assert
    expect(result).toEqual({ anonymized_count: 0, deleted_count: 0 });
    expect(await bookingExists(bookingId)).toBe(true);
    const { data: audit } = await db
      .from('audit_logs')
      .select('metadata')
      .eq('action', 'privacy.anonymized_by_email')
      .eq('actor_id', adminId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(audit?.metadata).toMatchObject({ retained_count: 1 });
  });
});
