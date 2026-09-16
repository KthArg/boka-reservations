// Ciclo de vida de una reserva diferida (spec 0029 §5.2, §5.6 y §5.7; migración …044): creación
// atómica, inicio del cobro, rechazos con reintentos, 3DS, cierre de intents y cambio de tarjeta.
// Llama las funciones SQL directo con service_role: el HTTP a OnvoPay lo hace el caller.
// Excede 150 líneas: excepción de testing-practices (lógica de dinero con muchos casos).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';
import {
  createActiveHold,
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  deferredArgs,
  EXPIRED_CARD,
  failCharge,
  HOUR_MS,
  isoFromNow,
  MANDATE_CENTS,
  MINUTE_MS,
  msFromNow,
  must,
  notificationKinds,
  notificationStatus,
  ok,
  paymentsOf,
  readBooking,
  readHoldStatus,
  startCharge,
  startChargeOutcome,
  type Db,
  type DeferredArgs,
} from './deferred-fixtures';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const TOLERANCE_MS = 2 * MINUTE_MS;
const ROOMY_LEAD_MS = 10 * DAY_MS;
const TIGHT_LEAD_MS = 90 * MINUTE_MS;

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tourIds: string[] = [];
let roomyInstanceId: string;
let tightInstanceId: string;

async function startsAtOf(instanceId: string): Promise<number> {
  const instance = must(
    await db.from('tour_instances').select('starts_at').eq('id', instanceId).single(),
    'startsAtOf',
  );
  return new Date(instance.starts_at).getTime();
}

/** Salida propia del test, para poder cancelarla o moverla al pasado sin afectar al resto. */
async function ownDeparture(): Promise<string> {
  const departure = await createDeparture(db, ROOMY_LEAD_MS);
  tourIds.push(departure.tourId);
  return departure.instanceId;
}

beforeAll(async () => {
  const roomy = await createDeparture(db, ROOMY_LEAD_MS);
  const tight = await createDeparture(db, TIGHT_LEAD_MS);
  tourIds.push(roomy.tourId, tight.tourId);
  roomyInstanceId = roomy.instanceId;
  tightInstanceId = tight.instanceId;
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

describe('create_deferred_booking', () => {
  it('creates a pending_minimum booking and moves the hold to paying atomically', async () => {
    // Arrange
    const hold = await createActiveHold(db, roomyInstanceId);

    // Act
    const bookingId = must(await db.rpc('create_deferred_booking', deferredArgs(hold)), 'rpc');

    // Assert
    const booking = await readBooking(db, bookingId);
    expect(booking).toMatchObject({
      status: 'pending_minimum',
      hold_id: hold.holdId,
      total_amount_cents: MANDATE_CENTS,
      customer_external_id: hold.customerId,
      card_last4: '4242',
      charge_attempts: 0,
    });
    expect(booking.consent_at).not.toBeNull();
    expect(await readHoldStatus(db, hold.holdId)).toBe('paying');
    expect(await notificationKinds(db, bookingId)).toEqual(['booking_reserved']);
  });

  it.each([
    ['HOLD_SESSION_MISMATCH', { p_session_token: 'otra-sesion' }],
    ['HOLD_CUSTOMER_MISMATCH', { p_customer_external_id: 'cus_ajeno' }],
    ['HOLD_SEATS_MISMATCH', { p_tickets_adult: 3 }],
    [
      'CARD_EXPIRES_BEFORE_DEPARTURE',
      { p_card_exp_month: EXPIRED_CARD.month, p_card_exp_year: EXPIRED_CARD.year },
    ],
    ['CARD_DATA_INVALID', { p_card_exp_month: 13 }],
    ['CONSENT_REQUIRED', { p_consent_version: null }],
  ])('rejects %s without creating a booking or taking the hold', async (code, overrides) => {
    // Arrange
    const hold = await createActiveHold(db, roomyInstanceId);

    // Act
    const { error } = await db.rpc(
      'create_deferred_booking',
      deferredArgs(hold, overrides as Partial<DeferredArgs>),
    );

    // Assert
    expect(error?.message).toContain(code);
    expect(await readHoldStatus(db, hold.holdId)).toBe('active');
    const { count } = await db
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('hold_id', hold.holdId);
    expect(count).toBe(0);
  });

  it('rejects a hold that already expired', async () => {
    // Arrange
    const hold = await createActiveHold(db, roomyInstanceId);
    ok(
      await db
        .from('tour_holds')
        .update({ expires_at: isoFromNow(-MINUTE_MS) })
        .eq('id', hold.holdId),
      'expire hold',
    );

    // Act
    const { error } = await db.rpc('create_deferred_booking', deferredArgs(hold));

    // Assert
    expect(error?.message).toContain('HOLD_NOT_ACTIVE');
  });

  it('rejects a departure cancelled while the tourist was entering the card', async () => {
    // Arrange
    const instanceId = await ownDeparture();
    const hold = await createActiveHold(db, instanceId);
    ok(
      await db.from('tour_instances').update({ status: 'cancelled' }).eq('id', instanceId),
      'cancel departure',
    );

    // Act
    const { error } = await db.rpc('create_deferred_booking', deferredArgs(hold));

    // Assert
    expect(error?.message).toContain('INSTANCE_UNAVAILABLE');
  });
});

describe('charge_booking_start', () => {
  it('opens one pending payment for the mandate on the first attempt', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = `pi_${crypto.randomUUID()}`;

    // Act
    const outcome = await startChargeOutcome(db, bookingId, intent);

    // Assert
    expect(outcome).toBe('started');
    const booking = await readBooking(db, bookingId);
    expect(booking.status).toBe('pending_payment');
    expect(booking.charge_started_at).not.toBeNull();
    const payments = await paymentsOf(db, bookingId);
    expect(payments.map((p) => [p.external_payment_id, p.status, p.amount_cents])).toEqual([
      [intent, 'pending', MANDATE_CENTS],
    ]);
  });

  it('reuses the re-confirmable intent on a retry and rejects a different one', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);
    await failCharge(db, bookingId, intent);

    // Act
    const withOther = await startChargeOutcome(db, bookingId, `pi_${crypto.randomUUID()}`);
    const withSame = await startChargeOutcome(db, bookingId, intent);

    // Assert
    expect([withOther, withSame]).toEqual(['intent_mismatch', 'started']);
    expect((await paymentsOf(db, bookingId)).map((p) => p.status)).toEqual(['pending']);
  });

  it('opens a new intent once the previous one is closed', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const first = await startCharge(db, bookingId);
    await failCharge(db, bookingId, first, true);

    // Act
    await startCharge(db, bookingId);

    // Assert
    expect((await paymentsOf(db, bookingId)).map((p) => p.status)).toEqual(['failed', 'pending']);
  });

  it('does not start a second charge while one is in flight', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    await startCharge(db, bookingId);

    // Act
    const outcome = await startChargeOutcome(db, bookingId, `pi_${crypto.randomUUID()}`);

    // Assert
    expect(outcome).toBe('not_chargeable');
    expect((await paymentsOf(db, bookingId)).length).toBe(1);
  });

  it('refuses to charge a card the tourist already replaced', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);

    // Act
    const outcome = must(
      await db.rpc('charge_booking_start', {
        p_booking_id: bookingId,
        p_external_payment_id: `pi_${crypto.randomUUID()}`,
        p_payment_method_id: 'pm_reemplazada',
      }),
      'rpc',
    );

    // Assert
    expect(outcome).toBe('payment_method_changed');
    expect(await paymentsOf(db, bookingId)).toEqual([]);
  });

  it.each([
    ['already started', { starts_at: isoFromNow(-MINUTE_MS) }],
    ['was cancelled', { status: 'cancelled' as const }],
  ])('refuses to charge a departure that %s', async (_case, change) => {
    // Arrange
    const instanceId = await ownDeparture();
    const { bookingId } = await createDeferredBooking(db, instanceId);
    ok(await db.from('tour_instances').update(change).eq('id', instanceId), 'change departure');

    // Act
    const outcome = await startChargeOutcome(db, bookingId, `pi_${crypto.randomUUID()}`);

    // Assert
    expect(outcome).toBe('departure_unavailable');
    expect((await readBooking(db, bookingId)).status).toBe('pending_minimum');
  });

  it('refuses to start once the recovery deadline passed', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    ok(
      await db
        .from('bookings')
        .update({ recovery_deadline: isoFromNow(-MINUTE_MS) })
        .eq('id', bookingId),
      'expire deadline',
    );

    // Act
    const outcome = await startChargeOutcome(db, bookingId, `pi_${crypto.randomUUID()}`);

    // Assert
    expect(outcome).toBe('recovery_expired');
    expect(await paymentsOf(db, bookingId)).toEqual([]);
  });
});

describe('charge_attempt_failed', () => {
  it('returns the booking to pending_minimum, retries in one hour and notifies', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);

    // Act
    const recorded = await failCharge(db, bookingId, intent);

    // Assert
    expect(recorded).toBe(true);
    const booking = await readBooking(db, bookingId);
    expect(booking).toMatchObject({
      status: 'pending_minimum',
      charge_attempts: 1,
      charge_last_error: 'card_declined',
    });
    expect(Math.abs(msFromNow(booking.charge_next_attempt_at) - HOUR_MS)).toBeLessThan(
      TOLERANCE_MS,
    );
    // Salida en 10 días: el plazo es el inicio de la ventana de decisión (24 h antes).
    const expectedDeadline = (await startsAtOf(roomyInstanceId)) - DAY_MS;
    expect(new Date(booking.recovery_deadline!).getTime()).toBe(expectedDeadline);
    expect((await paymentsOf(db, bookingId)).map((p) => p.status)).toEqual(['pending']);
    expect(await notificationKinds(db, bookingId)).toEqual([
      'booking_reserved',
      'charge_failed_action_required_1',
    ]);
  });

  it('closes the payment when the intent can no longer be confirmed', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);

    // Act
    await failCharge(db, bookingId, intent, true);

    // Assert
    const [payment] = await paymentsOf(db, bookingId);
    expect(payment.status).toBe('failed');
    expect(payment.failed_at).not.toBeNull();
    expect(payment.provider_closed_at).not.toBeNull();
  });

  it('ignores a stale response about a previous intent', async () => {
    // Arrange: el intent A se cerró y el cobro siguió con B.
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const previous = await startCharge(db, bookingId);
    await failCharge(db, bookingId, previous, true);
    const current = await startCharge(db, bookingId);

    // Act
    const recorded = await failCharge(db, bookingId, previous, true);

    // Assert
    expect(recorded).toBe(false);
    expect((await readBooking(db, bookingId)).status).toBe('pending_payment');
    const payments = await paymentsOf(db, bookingId);
    expect(payments.map((p) => [p.external_payment_id, p.status])).toEqual([
      [previous, 'failed'],
      [current, 'pending'],
    ]);
    expect(payments[1].provider_closed_at).toBeNull();
  });

  it('notifies without scheduling retries when less than two hours remain', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, tightInstanceId);
    const intent = await startCharge(db, bookingId);

    // Act
    await failCharge(db, bookingId, intent);

    // Assert
    const booking = await readBooking(db, bookingId);
    expect(booking.charge_next_attempt_at).toBeNull();
    expect(new Date(booking.recovery_deadline!).getTime()).toBe(await startsAtOf(tightInstanceId));
    expect(await notificationKinds(db, bookingId)).toContain('charge_failed_action_required_1');
  });

  it('backs off 1 h, 6 h and 24 h and stops scheduling after the third failure', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);
    const delaysInHours: (number | null)[] = [];

    // Act: cuatro rechazos seguidos sobre el mismo intent re-confirmable.
    for (let failure = 1; failure <= 4; failure++) {
      if (failure > 1) await startCharge(db, bookingId, intent);
      await failCharge(db, bookingId, intent);
      const { charge_next_attempt_at: next } = await readBooking(db, bookingId);
      delaysInHours.push(next === null ? null : Math.round(msFromNow(next) / HOUR_MS));
    }

    // Assert
    expect(delaysInHours).toEqual([1, 6, 24, null]);
    expect(await notificationKinds(db, bookingId)).toEqual([
      'booking_reserved',
      'charge_failed_action_required_1',
      'charge_failed_action_required_2',
      'charge_failed_action_required_3',
    ]);
  });

  it('sends a fresh notice for a failure after the third one was already sent', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);
    for (let failure = 1; failure <= 3; failure++) {
      if (failure > 1) await startCharge(db, bookingId, intent);
      await failCharge(db, bookingId, intent);
    }
    const third = await notificationStatus(db, bookingId, 'charge_failed_action_required_3');
    ok(
      await db.from('notifications').update({ status: 'sent' }).eq('id', third.id),
      'send third notice',
    );
    await startCharge(db, bookingId, intent);

    // Act
    await failCharge(db, bookingId, intent);

    // Assert
    const fresh = await notificationStatus(db, bookingId, 'charge_failed_action_required_3');
    expect(fresh.id).not.toBe(third.id);
    expect(fresh.status).toBe('pending');
  });
});

describe('charge_requires_action', () => {
  it('sets the authentication deadline once and sends a single link', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);
    const args = { p_booking_id: bookingId, p_external_payment_id: intent };

    // Act
    const first = must(await db.rpc('charge_requires_action', args), '1');
    const second = must(await db.rpc('charge_requires_action', args), '2');

    // Assert
    expect([first, second]).toEqual([true, false]);
    const booking = await readBooking(db, bookingId);
    expect(booking.status).toBe('pending_payment');
    expect(booking.awaiting_action_until).not.toBeNull();
    expect(booking.awaiting_action_until).toBe(booking.recovery_deadline);
    expect(await notificationKinds(db, bookingId)).toEqual([
      'booking_reserved',
      'charge_requires_action',
    ]);
  });

  it('ignores a 3DS response about an intent that is not in flight', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    await startCharge(db, bookingId);

    // Act
    const registered = must(
      await db.rpc('charge_requires_action', {
        p_booking_id: bookingId,
        p_external_payment_id: 'pi_ajeno',
      }),
      'rpc',
    );

    // Assert
    expect(registered).toBe(false);
    expect((await readBooking(db, bookingId)).awaiting_action_until).toBeNull();
  });
});

describe('close_pending_payment', () => {
  it('releases the pending row of an unpaid booking so a new intent can start', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);
    await failCharge(db, bookingId, intent);

    // Act
    const closed = must(
      await db.rpc('close_pending_payment', {
        p_booking_id: bookingId,
        p_external_payment_id: intent,
      }),
      'rpc',
    );

    // Assert
    expect(closed).toBe(true);
    const [payment] = await paymentsOf(db, bookingId);
    expect(payment.status).toBe('failed');
    expect(payment.provider_closed_at).not.toBeNull();
    expect(await startChargeOutcome(db, bookingId, `pi_${crypto.randomUUID()}`)).toBe('started');
  });

  it('does not touch a charge in flight', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);

    // Act
    const closed = must(
      await db.rpc('close_pending_payment', {
        p_booking_id: bookingId,
        p_external_payment_id: intent,
      }),
      'rpc',
    );

    // Assert
    expect(closed).toBe(false);
    expect((await paymentsOf(db, bookingId)).map((p) => p.status)).toEqual(['pending']);
  });
});

describe('update_booking_payment_method', () => {
  function cardArgs(
    bookingId: string,
    customerId: string,
    overrides: {
      p_payment_method_id?: string;
      p_card_exp_month?: number;
      p_card_exp_year?: number;
    } = {},
  ) {
    return {
      p_booking_id: bookingId,
      p_customer_external_id: customerId,
      p_payment_method_id: `pm_${crypto.randomUUID()}`,
      p_card_brand: 'mastercard',
      p_card_last4: '5454',
      p_card_exp_month: 11,
      p_card_exp_year: 2031,
      p_consent_version: 'test-v1',
      ...overrides,
    };
  }

  async function declinedBooking(chargeStartedAgoMs: number) {
    const { bookingId, hold } = await createDeferredBooking(db, roomyInstanceId);
    const intent = await startCharge(db, bookingId);
    await failCharge(db, bookingId, intent);
    ok(
      await db
        .from('bookings')
        .update({ charge_started_at: isoFromNow(-chargeStartedAgoMs) })
        .eq('id', bookingId),
      'age last attempt',
    );
    return { bookingId, customerId: hold.customerId };
  }

  it('replaces the card and retries right away when the last attempt is over an hour old', async () => {
    // Arrange
    const { bookingId, customerId } = await declinedBooking(2 * HOUR_MS);
    const args = cardArgs(bookingId, customerId);

    // Act
    const outcome = must(await db.rpc('update_booking_payment_method', args), 'rpc');

    // Assert
    expect(outcome).toBe('updated');
    const booking = await readBooking(db, bookingId);
    expect(booking).toMatchObject({
      payment_method_id: args.p_payment_method_id,
      card_last4: '5454',
    });
    expect(Math.abs(msFromNow(booking.charge_next_attempt_at))).toBeLessThan(TOLERANCE_MS);
  });

  it('waits an hour after the last attempt before retrying with a new card', async () => {
    // Arrange
    const { bookingId, customerId } = await declinedBooking(10 * MINUTE_MS);

    // Act
    must(await db.rpc('update_booking_payment_method', cardArgs(bookingId, customerId)), 'rpc');

    // Assert
    const booking = await readBooking(db, bookingId);
    const expected = HOUR_MS - 10 * MINUTE_MS;
    expect(Math.abs(msFromNow(booking.charge_next_attempt_at) - expected)).toBeLessThan(
      TOLERANCE_MS,
    );
  });

  it('returns not_updatable while a charge is in flight', async () => {
    // Arrange
    const { bookingId, hold } = await createDeferredBooking(db, roomyInstanceId);
    await startCharge(db, bookingId);

    // Act
    const outcome = must(
      await db.rpc('update_booking_payment_method', cardArgs(bookingId, hold.customerId)),
      'rpc',
    );

    // Assert
    expect(outcome).toBe('not_updatable');
    expect((await readBooking(db, bookingId)).card_last4).toBe('4242');
  });

  it.each([
    { expected: 'customer_mismatch', foreignCustomer: 'cus_ajeno', overrides: {} },
    { expected: 'card_data_invalid', foreignCustomer: null, overrides: { p_card_exp_month: 13 } },
    {
      expected: 'card_expires_before_departure',
      foreignCustomer: null,
      overrides: { p_card_exp_month: EXPIRED_CARD.month, p_card_exp_year: EXPIRED_CARD.year },
    },
  ])(
    'returns $expected and keeps the current card',
    async ({ expected, foreignCustomer, overrides }) => {
      // Arrange
      const { bookingId, hold } = await createDeferredBooking(db, roomyInstanceId);
      const customerId = foreignCustomer ?? hold.customerId;

      // Act
      const outcome = must(
        await db.rpc('update_booking_payment_method', cardArgs(bookingId, customerId, overrides)),
        'rpc',
      );

      // Assert
      expect(outcome).toBe(expected);
      expect((await readBooking(db, bookingId)).card_last4).toBe('4242');
    },
  );

  it('rejects a card that already backs another live booking', async () => {
    // Arrange
    const first = await createDeferredBooking(db, roomyInstanceId);
    const second = await createDeferredBooking(db, roomyInstanceId);
    const { payment_method_id: taken } = await readBooking(db, first.bookingId);

    // Act
    const { error } = await db.rpc(
      'update_booking_payment_method',
      cardArgs(second.bookingId, second.hold.customerId, { p_payment_method_id: taken! }),
    );

    // Assert
    expect(error?.code).toBe('23505');
    expect(error?.message).toContain('bookings_one_live_per_payment_method');
  });
});
