// Cancelación de reservas sin cobrar desde las server actions (spec 0029 §5.8): el turista por el
// enlace de la reserva y el staff desde el panel, contra DB real.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import { hashBookingToken } from '@/lib/booking/booking-token-hash';
import { CancellationError } from '@shared/constants/cancellations';
import { deleteToursDeep } from './cleanup';
import {
  auditEntries,
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  isoFromNow,
  must,
  ok,
  readBooking,
  startCharge,
  userIdByEmail,
  type Db,
} from './deferred-fixtures';

const requireAnyRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/server', () => ({ requireAnyRole: requireAnyRoleMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { cancelByStaff, cancelByToken } = await import('@/lib/booking/cancel-action');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const NO_REFUND = { eligible: false, amountCents: 0 };
const tourIds: string[] = [];
let instanceId: string;
let staffId: string;

async function accessTokenFor(bookingId: string): Promise<string> {
  const token = crypto.randomUUID();
  ok(
    await db.from('booking_access_tokens').insert({
      booking_id: bookingId,
      token_hash: hashBookingToken(token),
      expires_at: isoFromNow(10 * DAY_MS),
    }),
    'token',
  );
  return token;
}

/** Checkout con widget abandonado: pending_payment sin tarjeta guardada. */
async function widgetCheckout(): Promise<string> {
  const booking = must(
    await db
      .from('bookings')
      .insert({
        tour_instance_id: instanceId,
        customer_name: 'Turista Widget',
        customer_email: 'widget@example.com',
        tickets_adult: 1,
        total_amount_cents: 5000,
        currency: 'USD',
        status: 'pending_payment',
        locale: 'es',
      })
      .select('id')
      .single(),
    'widget booking',
  );
  return booking.id;
}

beforeAll(async () => {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
  staffId = await userIdByEmail(db, 'staff@bokatrails.com');
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

beforeEach(() => {
  requireAnyRoleMock.mockReset();
  requireAnyRoleMock.mockResolvedValue({ id: staffId, userRole: 'staff' });
});

describe('cancelByToken — reserva sin cobrar', () => {
  it('cancels the unpaid booking of the tourist with no refund', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    const token = await accessTokenFor(bookingId);

    // Act
    const result = await cancelByToken(token);

    // Assert
    expect(result).toEqual({ ok: true, refund: NO_REFUND });
    expect((await readBooking(db, bookingId)).status).toBe('cancelled');
    const audits = await auditEntries(db, bookingId, 'booking.cancelled');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_type: 'tourist',
      metadata: { reason: 'customer_request' },
    });
  });

  it('asks to retry while the charge is in flight and leaves the booking untouched', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    await startCharge(db, bookingId);
    const token = await accessTokenFor(bookingId);

    // Act
    const result = await cancelByToken(token);

    // Assert
    expect(result).toEqual({ ok: false, error: CancellationError.ChargeInFlight });
    expect((await readBooking(db, bookingId)).status).toBe('pending_payment');
  });
});

describe('cancelByStaff — reserva sin cobrar', () => {
  it('cancels an unpaid booking and records the staff member', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);

    // Act
    const result = await cancelByStaff(bookingId);

    // Assert
    expect(result).toEqual({ ok: true, refund: NO_REFUND });
    const audits = await auditEntries(db, bookingId, 'booking.cancelled');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_type: 'staff',
      actor_id: staffId,
      metadata: { reason: 'staff_request' },
    });
  });

  it('still refuses to cancel an abandoned widget checkout', async () => {
    // Arrange
    const bookingId = await widgetCheckout();

    // Act
    const result = await cancelByStaff(bookingId);

    // Assert
    expect(result).toEqual({ ok: false, error: CancellationError.NotCancellable });
    expect((await readBooking(db, bookingId)).status).toBe('pending_payment');
  });
});
