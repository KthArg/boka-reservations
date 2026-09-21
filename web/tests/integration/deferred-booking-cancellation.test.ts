// Cancelaciones del flujo diferido y cierre manual de intents (spec 0029 §5.7, §5.8 y §5.9;
// migración …044): cancel_unpaid_booking, cancel_charge_in_flight, cobros que liquidan tarde y
// mark_payment_provider_closed. Llama las funciones SQL directo con service_role.
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
  isoFromNow,
  MANDATE_CENTS,
  MANDATE_CURRENCY,
  MINUTE_MS,
  must,
  notificationKinds,
  notificationStatus,
  ok,
  paymentsOf,
  readBooking,
  readHoldStatus,
  startCharge,
  userIdByEmail,
  type Db,
} from './deferred-fixtures';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tourIds: string[] = [];
const eventIds: string[] = [];
let instanceId: string;
let staffId: string;

async function capacityReserved(): Promise<number> {
  const instance = must(
    await db.from('tour_instances').select('capacity_reserved').eq('id', instanceId).single(),
    'capacityReserved',
  );
  return instance.capacity_reserved;
}

type UnpaidCancelReason =
  Database['public']['Functions']['cancel_unpaid_booking']['Args']['p_reason'];

function cancelUnpaid(
  bookingId: string,
  reason: UnpaidCancelReason = 'customer_request',
  actorId: string | null = null,
) {
  return db.rpc('cancel_unpaid_booking', {
    p_booking_id: bookingId,
    p_actor_id: actorId,
    p_reason: reason,
  });
}

function lateConfirm(bookingId: string, intent: string) {
  eventIds.push(intent);
  return db.rpc('confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: intent,
    p_event_id: intent,
    p_paid_amount_cents: MANDATE_CENTS,
    p_paid_currency: MANDATE_CURRENCY,
  });
}

beforeAll(async () => {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
  staffId = await userIdByEmail(db, 'staff@bokatrails.com');
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
  for (const id of eventIds) await db.from('processed_webhook_events').delete().eq('id', id);
});

describe('cancel_unpaid_booking', () => {
  it('cancels an unpaid booking, releases its hold and closes its pending payment', async () => {
    // Arrange
    const { bookingId, hold } = await createDeferredBooking(db, instanceId);
    const intent = await startCharge(db, bookingId);
    await failCharge(db, bookingId, intent);
    const capacityBefore = await capacityReserved();

    // Act
    const outcome = must(await cancelUnpaid(bookingId), 'rpc');

    // Assert
    expect(outcome).toBe('cancelled');
    const booking = await readBooking(db, bookingId);
    expect(booking.status).toBe('cancelled');
    expect(booking.charge_next_attempt_at).toBeNull();
    expect(await readHoldStatus(db, hold.holdId)).toBe('released');
    const [payment] = await paymentsOf(db, bookingId);
    expect(payment.status).toBe('failed');
    expect(payment.failed_at).not.toBeNull();
    expect(await capacityReserved()).toBe(capacityBefore);
    expect(await notificationKinds(db, bookingId)).toContain('cancellation_confirmation');
    const audits = await auditEntries(db, bookingId, 'booking.cancelled');
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    expect(audit.actor_type).toBe('tourist');
  });

  it('cancels the charge notices that were still waiting to be sent', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    const intent = await startCharge(db, bookingId);
    await failCharge(db, bookingId, intent);

    // Act
    must(await cancelUnpaid(bookingId), 'rpc');

    // Assert
    const notice = await notificationStatus(db, bookingId, 'charge_failed_action_required_1');
    expect(notice).toMatchObject({ status: 'cancelled', cancelled_reason: 'booking_cancelled' });
  });

  it('rejects cancelling while a charge is in flight', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    await startCharge(db, bookingId);

    // Act
    const outcome = must(await cancelUnpaid(bookingId), 'rpc');

    // Assert
    expect(outcome).toBe('charge_in_flight');
    expect((await readBooking(db, bookingId)).status).toBe('pending_payment');
  });

  it('does not cancel a booking that was already charged', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    const intent = await startCharge(db, bookingId);
    must(await lateConfirm(bookingId, intent), 'confirm');

    // Act
    const outcome = must(await cancelUnpaid(bookingId), 'rpc');

    // Assert
    expect(outcome).toBe('not_cancellable');
    expect((await readBooking(db, bookingId)).status).toBe('confirmed');
  });

  it('records the staff member who cancelled', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);

    // Act
    must(await cancelUnpaid(bookingId, 'staff_request', staffId), 'rpc');

    // Assert
    const audits = await auditEntries(db, bookingId, 'booking.cancelled');
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    expect(audit).toMatchObject({ actor_type: 'staff', actor_id: staffId });
  });

  it('rejects a reason outside the allowed list', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);

    // Act
    const { error } = await cancelUnpaid(bookingId, 'porque_si' as UnpaidCancelReason);

    // Assert
    expect(error?.message).toContain('INVALID_CANCEL_REASON');
    expect((await readBooking(db, bookingId)).status).toBe('pending_minimum');
  });

  it('refunds a charge that settles after the unpaid booking was cancelled', async () => {
    // Arrange: rechazo con el intent re-confirmable y cancelación del turista.
    const { bookingId, intent } = await cancelledWithUnclosedIntent(db, instanceId);

    // Act
    const outcome = must(await lateConfirm(bookingId, intent), 'rpc');

    // Assert
    expect(outcome).toBe('late_payment_refunded');
    const refunds = must(
      await db.from('refunds').select('amount_cents, reason').eq('booking_id', bookingId),
      'refunds',
    );
    expect(refunds).toEqual([{ amount_cents: MANDATE_CENTS, reason: 'late_payment' }]);
  });
});

describe('cancel_charge_in_flight', () => {
  async function chargeAwaitingAuthentication() {
    const fixture = await createDeferredBooking(db, instanceId);
    const intent = await startCharge(db, fixture.bookingId);
    must(
      await db.rpc('charge_requires_action', {
        p_booking_id: fixture.bookingId,
        p_external_payment_id: intent,
      }),
      '3ds',
    );
    return { ...fixture, intent };
  }

  it('does not cancel before the authentication deadline', async () => {
    // Arrange
    const { bookingId } = await chargeAwaitingAuthentication();

    // Act
    const cancelled = must(
      await db.rpc('cancel_charge_in_flight', {
        p_booking_id: bookingId,
        p_reason: 'action_expired',
      }),
      'rpc',
    );

    // Assert
    expect(cancelled).toBe(false);
    expect((await readBooking(db, bookingId)).status).toBe('pending_payment');
  });

  it('cancels after the deadline and refunds a charge that settles late', async () => {
    // Arrange
    const { bookingId, hold, intent } = await chargeAwaitingAuthentication();
    ok(
      await db
        .from('bookings')
        .update({ awaiting_action_until: isoFromNow(-MINUTE_MS) })
        .eq('id', bookingId),
      'expire 3ds',
    );

    // Act: vence el 3DS, y después el turista autentica tarde y el cobro liquida.
    const cancelled = must(
      await db.rpc('cancel_charge_in_flight', {
        p_booking_id: bookingId,
        p_reason: 'action_expired',
      }),
      'cancel',
    );
    const late = must(await lateConfirm(bookingId, intent), 'late confirm');

    // Assert
    expect(cancelled).toBe(true);
    expect(await readHoldStatus(db, hold.holdId)).toBe('released');
    expect(late).toBe('late_payment_refunded');
    const notice = await notificationStatus(db, bookingId, 'charge_requires_action');
    expect(notice.status).toBe('cancelled');
  });

  it('rejects an unknown reason', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    await startCharge(db, bookingId);

    // Act
    const { error } = await db.rpc('cancel_charge_in_flight', {
      p_booking_id: bookingId,
      p_reason: 'just_because' as 'action_expired',
    });

    // Assert
    expect(error?.message).toContain('INVALID_CANCEL_REASON');
  });
});

describe('mark_payment_provider_closed', () => {
  function markClosed(paymentId: string) {
    return db.rpc('mark_payment_provider_closed', { p_payment_id: paymentId, p_actor_id: staffId });
  }

  it('records the manual closure once, with its actor, after the seven-day window', async () => {
    // Arrange
    const { bookingId } = await cancelledWithUnclosedIntent(db, instanceId);
    await ageFailedPayments(db, bookingId);
    const [payment] = await paymentsOf(db, bookingId);

    // Act
    const first = must(await markClosed(payment.id), 'first');
    const second = must(await markClosed(payment.id), 'second');

    // Assert
    expect([first, second]).toEqual([true, false]);
    const [closed] = await paymentsOf(db, bookingId);
    expect(closed.provider_closed_at).not.toBeNull();
    const audits = await auditEntries(db, bookingId, 'payment.provider_closed_manually');
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    expect(audit).toMatchObject({ actor_type: 'staff', actor_id: staffId });
  });

  it('refuses a manual closure while the automatic sweep can still close the intent', async () => {
    // Arrange
    const { bookingId } = await cancelledWithUnclosedIntent(db, instanceId);
    const [payment] = await paymentsOf(db, bookingId);

    // Act
    const closed = must(await markClosed(payment.id), 'rpc');

    // Assert
    expect(closed).toBe(false);
    expect((await paymentsOf(db, bookingId))[0].provider_closed_at).toBeNull();
  });
});
