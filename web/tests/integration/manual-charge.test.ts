// Cobro manual del panel (spec 0029 §5.6, §5.11): server action contra DB real, con OnvoPay
// simulado. Verifica el invariante anti-doble-cobro: GET antes de re-confirmar, un solo intent vivo
// y ningún intent creado sin su fila.
// Excede 150 líneas: excepción de testing-practices (lógica de dinero con muchos casos).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import type { IntentSnapshot } from '@/lib/payments/types';
import { deleteToursDeep } from './cleanup';
import {
  auditEntries,
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  elapseRetrySpacing,
  isoFromNow,
  MANDATE_CENTS,
  MANDATE_CURRENCY,
  MINUTE_MS,
  must,
  ok,
  paymentsOf,
  readBooking,
  uid,
  userIdByEmail,
  type Db,
} from './deferred-fixtures';

const provider = vi.hoisted(() => ({
  createPaymentSession: vi.fn(),
  getPaymentIntent: vi.fn(),
  confirmWithPaymentMethod: vi.fn(),
  cancelPaymentSession: vi.fn(),
}));
const requireAnyRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments', () => ({ getPaymentProvider: () => provider }));
vi.mock('@/lib/auth/server', () => ({ requireAnyRole: requireAnyRoleMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: () => Promise.resolve('es') }));

const { chargeBookingAction } = await import('@/lib/booking/manual-charge-action');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tourIds: string[] = [];
const createdIntents: string[] = [];
let instanceId: string;
let staffId: string;

const intentIn = (status: string, amountCents = MANDATE_CENTS): IntentSnapshot => ({
  status,
  amountCents,
  currency: MANDATE_CURRENCY,
});

const outcomeOf = async (bookingId: string) => (await chargeBookingAction(bookingId)).outcome;

/** Reserva con un primer cobro rechazado (fila `pending` con su intent re-confirmable). */
async function declinedOnce() {
  const { bookingId } = await createDeferredBooking(db, instanceId);
  provider.confirmWithPaymentMethod.mockResolvedValueOnce(intentIn('requires_payment_method'));
  expect(await outcomeOf(bookingId)).toBe('declined');
  const [payment] = await paymentsOf(db, bookingId);
  return { bookingId, intent: payment.external_payment_id };
}

beforeAll(async () => {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
  staffId = await userIdByEmail(db, 'staff@bokatrails.com');
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
  if (createdIntents.length > 0) {
    await db.from('processed_webhook_events').delete().in('id', createdIntents);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAnyRoleMock.mockResolvedValue({ id: staffId, userRole: 'staff' });
  provider.createPaymentSession.mockImplementation(() => {
    const externalPaymentId = `pi_${uid()}`;
    createdIntents.push(externalPaymentId);
    return Promise.resolve({ externalPaymentId });
  });
  provider.cancelPaymentSession.mockResolvedValue(undefined);
});

describe('chargeBookingAction — primer cobro', () => {
  it('charges the saved card, confirms the booking and audits who started it', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    provider.confirmWithPaymentMethod.mockResolvedValue(intentIn('succeeded'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('confirmed');
    expect((await readBooking(db, bookingId)).status).toBe('confirmed');
    expect((await paymentsOf(db, bookingId)).map((p) => p.status)).toEqual(['succeeded']);
    const audits = await auditEntries(db, bookingId, 'charge.started');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_type: 'staff', actor_id: staffId });
  });

  it('records a decline and keeps the intent for the next attempt', async () => {
    // Act
    const { bookingId } = await declinedOnce();

    // Assert
    const booking = await readBooking(db, bookingId);
    expect(booking).toMatchObject({ status: 'pending_minimum', charge_attempts: 1 });
    expect((await paymentsOf(db, bookingId)).map((p) => p.status)).toEqual(['pending']);
  });

  it('registers a 3DS challenge so the tourist receives the authentication link', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    provider.confirmWithPaymentMethod.mockResolvedValue(intentIn('requires_action'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('requires_action');
    expect((await readBooking(db, bookingId)).awaiting_action_until).not.toBeNull();
  });

  it('leaves the charge in flight when OnvoPay does not answer the confirm', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    provider.confirmWithPaymentMethod.mockRejectedValue(new Error('OnvoPay timeout'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('in_progress');
    const booking = await readBooking(db, bookingId);
    expect(booking.status).toBe('pending_payment');
    expect(booking.charge_started_at).not.toBeNull();
  });

  it('flags a settled charge whose amount does not match the booking', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    provider.confirmWithPaymentMethod.mockResolvedValue(intentIn('succeeded', MANDATE_CENTS + 100));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('mismatch');
    expect((await readBooking(db, bookingId)).status).toBe('payment_mismatch');
  });
});

describe('chargeBookingAction — Volver a cobrar', () => {
  it('refuses a new attempt within an hour of the previous one', async () => {
    // Arrange
    const { bookingId } = await declinedOnce();
    provider.getPaymentIntent.mockResolvedValue(intentIn('requires_payment_method'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('retry_too_soon');
    expect(provider.confirmWithPaymentMethod).toHaveBeenCalledTimes(1);
    expect(provider.cancelPaymentSession).not.toHaveBeenCalled();
  });

  it('re-confirms the same intent after reading it, without creating another', async () => {
    // Arrange
    const { bookingId, intent } = await declinedOnce();
    await elapseRetrySpacing(db, bookingId);
    provider.getPaymentIntent.mockResolvedValue(intentIn('requires_payment_method'));
    provider.confirmWithPaymentMethod.mockResolvedValueOnce(intentIn('succeeded'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('confirmed');
    expect(provider.createPaymentSession).toHaveBeenCalledTimes(1);
    expect(provider.confirmWithPaymentMethod).toHaveBeenLastCalledWith(
      intent,
      expect.any(String),
      expect.any(String),
    );
    expect((await paymentsOf(db, bookingId)).map((p) => p.status)).toEqual(['succeeded']);
  });

  it('confirms without charging again when the previous intent already settled', async () => {
    // Arrange
    const { bookingId } = await declinedOnce();
    await elapseRetrySpacing(db, bookingId);
    provider.getPaymentIntent.mockResolvedValue(intentIn('succeeded'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('confirmed');
    expect(provider.confirmWithPaymentMethod).toHaveBeenCalledTimes(1);
    expect((await readBooking(db, bookingId)).status).toBe('confirmed');
  });

  it('closes a canceled intent before creating a new one', async () => {
    // Arrange
    const { bookingId } = await declinedOnce();
    await elapseRetrySpacing(db, bookingId);
    provider.getPaymentIntent.mockResolvedValue(intentIn('canceled'));
    provider.confirmWithPaymentMethod.mockResolvedValueOnce(intentIn('succeeded'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('confirmed');
    const payments = await paymentsOf(db, bookingId);
    expect(payments.map((p) => p.status)).toEqual(['failed', 'succeeded']);
    expect(payments[0].provider_closed_at).not.toBeNull();
  });

  it('waits when the previous intent is still processing', async () => {
    // Arrange
    const { bookingId } = await declinedOnce();
    await elapseRetrySpacing(db, bookingId);
    provider.getPaymentIntent.mockResolvedValue(intentIn('processing'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('in_progress');
    expect(provider.confirmWithPaymentMethod).toHaveBeenCalledTimes(1);
  });
});

describe('chargeBookingAction — sin cobrar', () => {
  it('cancels the intent it created when the departure is no longer chargeable', async () => {
    // Arrange
    const departure = await createDeparture(db, 10 * DAY_MS);
    tourIds.push(departure.tourId);
    const { bookingId } = await createDeferredBooking(db, departure.instanceId);
    ok(
      await db
        .from('tour_instances')
        .update({ starts_at: isoFromNow(-MINUTE_MS) })
        .eq('id', departure.instanceId),
      'start departure',
    );

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('departure_unavailable');
    const [created] = createdIntents.slice(-1);
    expect(provider.cancelPaymentSession).toHaveBeenCalledWith(created);
    expect(await paymentsOf(db, bookingId)).toEqual([]);
  });

  it('does not charge a booking without a saved card', async () => {
    // Arrange
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
          status: 'confirmed',
          locale: 'es',
        })
        .select('id')
        .single(),
      'booking',
    );

    // Act
    const outcome = await outcomeOf(booking.id);

    // Assert
    expect(outcome).toBe('not_chargeable');
    expect(provider.createPaymentSession).not.toHaveBeenCalled();
  });

  it('rejects a user without a panel role before touching OnvoPay', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    requireAnyRoleMock.mockRejectedValue(new Error('UNAUTHORIZED'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('unauthorized');
    expect(provider.createPaymentSession).not.toHaveBeenCalled();
    expect((await readBooking(db, bookingId)).status).toBe('pending_minimum');
  });
});
