// Vista de la reserva por token y sus enlaces del cobro diferido (spec 0029 §5.7, §5.9): la página
// muestra "Actualizar la tarjeta" y "Confirmar el pago" solo en su estado, con las mismas reglas que
// las páginas a las que llevan. Contra DB real.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import { getBookingView } from '@/lib/booking/cancel';
import { loadAuthenticationTarget } from '@/lib/booking/deferred-booking-access';
import { deleteToursDeep } from './cleanup';
import {
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  failCharge,
  isoFromNow,
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

async function viewOf(bookingId: string) {
  const view = await getBookingView(db, bookingId);
  if (!view) throw new Error('sin vista');
  return view;
}

beforeAll(async () => {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

describe('getBookingView — enlaces del cobro diferido', () => {
  it('offers no card update before any declined charge', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);

    // Act
    const view = await viewOf(bookingId);

    // Assert
    expect(view).toMatchObject({ canUpdateCard: false, awaitingAuthentication: false });
  });

  it('offers the card update after a decline while the recovery deadline is ahead', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    await failCharge(db, bookingId, await startCharge(db, bookingId));

    // Act
    const view = await viewOf(bookingId);

    // Assert
    expect(view.canUpdateCard).toBe(true);
  });

  it('stops offering the card update once the recovery deadline passed', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    await failCharge(db, bookingId, await startCharge(db, bookingId));
    ok(
      await db
        .from('bookings')
        .update({ recovery_deadline: isoFromNow(-MINUTE_MS) })
        .eq('id', bookingId),
      'expire',
    );

    // Act
    const view = await viewOf(bookingId);

    // Assert
    expect(view.canUpdateCard).toBe(false);
  });

  it('offers the authentication while a 3DS challenge is pending', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    const intent = await startCharge(db, bookingId);
    ok(
      await db.rpc('charge_requires_action', {
        p_booking_id: bookingId,
        p_external_payment_id: intent,
      }),
      '3ds',
    );

    // Act
    const view = await viewOf(bookingId);

    // Assert
    expect(view).toMatchObject({ chargeInFlight: true, awaitingAuthentication: true });
  });

  it('does not offer the authentication for a charge in flight without a 3DS challenge', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    await startCharge(db, bookingId);

    // Act
    const view = await viewOf(bookingId);

    // Assert
    expect(view).toMatchObject({ chargeInFlight: true, awaitingAuthentication: false });
  });
});

describe('loadAuthenticationTarget — reserva cancelada', () => {
  it('says the booking was cancelled and never returns its intent', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    await failCharge(db, bookingId, await startCharge(db, bookingId));
    must(
      await db.rpc('cancel_unpaid_booking', {
        p_booking_id: bookingId,
        p_actor_id: null,
        p_reason: 'customer_request',
      }),
      'cancel',
    );

    // Act
    const access = await loadAuthenticationTarget(db, bookingId);

    // Assert
    expect(access).toEqual({ ok: false, reason: 'cancelled' });
  });
});
