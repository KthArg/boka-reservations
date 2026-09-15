// Acceso a las páginas de tarjeta y de 3DS de una reserva (spec 0029 §5.9): cada una solo en su
// estado, y la de 3DS nunca entrega el intent fuera de él. Contra DB real.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import {
  loadAuthenticationTarget,
  loadCardUpdateTarget,
} from '@/lib/booking/deferred-booking-access';
import { deleteToursDeep } from './cleanup';
import {
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  failCharge,
  isoFromNow,
  MANDATE_CENTS,
  MINUTE_MS,
  must,
  ok,
  startCharge,
  type Db,
} from './deferred-fixtures';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tourIds: string[] = [];
let instanceId: string;

async function awaitingAuthentication() {
  const { bookingId } = await createDeferredBooking(db, instanceId);
  const intent = await startCharge(db, bookingId);
  ok(
    await db.rpc('charge_requires_action', {
      p_booking_id: bookingId,
      p_external_payment_id: intent,
    }),
    '3ds',
  );
  return { bookingId, intent };
}

beforeAll(async () => {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

describe('loadCardUpdateTarget', () => {
  it('offers the card page of a declined unpaid booking with its customer and card', async () => {
    // Arrange
    const { bookingId, hold } = await createDeferredBooking(db, instanceId);
    await failCharge(db, bookingId, await startCharge(db, bookingId));

    // Act
    const access = await loadCardUpdateTarget(db, bookingId);

    // Assert
    expect(access).toMatchObject({
      ok: true,
      target: { customerId: hold.customerId, cardLast4: '4242', totalAmountCents: MANDATE_CENTS },
    });
  });

  it('says the booking was cancelled instead of showing the card', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    must(
      await db.rpc('cancel_unpaid_booking', {
        p_booking_id: bookingId,
        p_actor_id: null,
        p_reason: 'customer_request',
      }),
      'cancel',
    );

    // Act
    const access = await loadCardUpdateTarget(db, bookingId);

    // Assert
    expect(access).toEqual({ ok: false, reason: 'cancelled' });
  });

  it.each([
    ['the recovery deadline passed', 'expired'],
    ['a charge is in flight', 'in_flight'],
  ])('hides the card page when %s', async (_case, scenario) => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    if (scenario === 'in_flight') await startCharge(db, bookingId);
    else {
      ok(
        await db
          .from('bookings')
          .update({ recovery_deadline: isoFromNow(-MINUTE_MS) })
          .eq('id', bookingId),
        'expire',
      );
    }

    // Act
    const access = await loadCardUpdateTarget(db, bookingId);

    // Assert
    expect(access).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('loadAuthenticationTarget', () => {
  it('returns the intent only while the authentication is pending', async () => {
    // Arrange
    const { bookingId, intent } = await awaitingAuthentication();

    // Act
    const access = await loadAuthenticationTarget(db, bookingId);

    // Assert
    expect(access).toMatchObject({ ok: true, target: { paymentIntentId: intent } });
  });

  it('never returns the intent once the authentication deadline passed', async () => {
    // Arrange
    const { bookingId } = await awaitingAuthentication();
    ok(
      await db
        .from('bookings')
        .update({ awaiting_action_until: isoFromNow(-MINUTE_MS) })
        .eq('id', bookingId),
      'expire 3ds',
    );

    // Act
    const access = await loadAuthenticationTarget(db, bookingId);

    // Assert
    expect(access).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('has nothing to authenticate for an unpaid booking without a charge in flight', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);

    // Act
    const access = await loadAuthenticationTarget(db, bookingId);

    // Assert
    expect(access).toEqual({ ok: false, reason: 'unavailable' });
  });
});
