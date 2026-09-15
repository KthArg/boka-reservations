// Cobro manual del panel, casos borde (spec 0029 §5.6, §5.11): concurrencia, respuestas incompletas,
// escrituras condicionales sin efecto e intents retenidos anómalos. Server action contra DB real,
// con OnvoPay y Sentry simulados: cada camino a "revisión manual" tiene que alertar.
// Excede 150 líneas: excepción de testing-practices (lógica de dinero con muchos casos).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import type { IntentSnapshot } from '@/lib/payments/types';
import { deleteToursDeep } from './cleanup';
import {
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  isoFromNow,
  MANDATE_CENTS,
  MANDATE_CURRENCY,
  MINUTE_MS,
  notificationKinds,
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
const sentry = vi.hoisted(() => ({ fingerprints: [] as string[] }));
const requireAnyRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments', () => ({ getPaymentProvider: () => provider }));
vi.mock('@/lib/auth/server', () => ({ requireAnyRole: requireAnyRoleMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  withScope: (callback: (scope: unknown) => void) =>
    callback({
      setLevel: () => undefined,
      setFingerprint: ([value]: string[]) => sentry.fingerprints.push(value ?? ''),
      setExtra: () => undefined,
    }),
  captureMessage: () => undefined,
  captureException: () => undefined,
}));

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

const intentIn = (
  status: string,
  amountCents: number | undefined = MANDATE_CENTS,
): IntentSnapshot => ({
  status,
  amountCents,
  currency: amountCents === undefined ? undefined : MANDATE_CURRENCY,
});

const outcomeOf = async (bookingId: string) => (await chargeBookingAction(bookingId)).outcome;

/** Reserva con un primer cobro rechazado y la hora mínima ya cumplida. */
async function declinedAndSpaced() {
  const { bookingId } = await createDeferredBooking(db, instanceId);
  provider.confirmWithPaymentMethod.mockResolvedValueOnce(intentIn('requires_payment_method'));
  expect(await outcomeOf(bookingId)).toBe('declined');
  ok(
    await db
      .from('bookings')
      .update({ charge_started_at: isoFromNow(-61 * MINUTE_MS) })
      .eq('id', bookingId),
    'elapse spacing',
  );
  return bookingId;
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
  sentry.fingerprints.length = 0;
  requireAnyRoleMock.mockResolvedValue({ id: staffId, userRole: 'staff' });
  provider.createPaymentSession.mockImplementation(() => {
    const externalPaymentId = `pi_${uid()}`;
    createdIntents.push(externalPaymentId);
    return Promise.resolve({ externalPaymentId });
  });
  provider.cancelPaymentSession.mockResolvedValue(undefined);
});

describe('cobro manual — concurrencia', () => {
  it('charges once when two staff members charge the same booking at the same time', async () => {
    // Arrange: los dos crean su intent antes de que cualquiera registre el inicio.
    const { bookingId } = await createDeferredBooking(db, instanceId);
    let release: () => void = () => undefined;
    const bothCreated = new Promise<void>((resolve) => (release = resolve));
    let creations = 0;
    provider.createPaymentSession.mockImplementation(async () => {
      const externalPaymentId = `pi_${uid()}`;
      createdIntents.push(externalPaymentId);
      creations += 1;
      if (creations === 2) release();
      await bothCreated;
      return { externalPaymentId };
    });
    provider.confirmWithPaymentMethod.mockResolvedValue(intentIn('succeeded'));

    // Act
    const outcomes = await Promise.all([outcomeOf(bookingId), outcomeOf(bookingId)]);

    // Assert
    expect(outcomes.sort()).toEqual(['confirmed', 'not_chargeable']);
    expect(provider.confirmWithPaymentMethod).toHaveBeenCalledTimes(1);
    expect(provider.cancelPaymentSession).toHaveBeenCalledTimes(1);
    expect((await paymentsOf(db, bookingId)).map((p) => p.status)).toEqual(['succeeded']);
  });
});

describe('cobro manual — respuestas y estados anómalos', () => {
  it('sends a settled charge without amount to review instead of flagging a mismatch', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    // Un parámetro undefined tomaría el monto por defecto: el snapshot se arma sin monto a mano.
    provider.confirmWithPaymentMethod.mockResolvedValue({ status: 'succeeded' });

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('review');
    expect((await readBooking(db, bookingId)).status).toBe('pending_payment');
    expect(sentry.fingerprints).toContain('manual-charge-settled-without-amount');
  });

  it('does not report as confirmed a charge whose event was already consumed without confirming', async () => {
    // Arrange: otro actor consumió el evento de este intent y la reserva no se confirmó.
    const { bookingId } = await createDeferredBooking(db, instanceId);
    provider.createPaymentSession.mockImplementation(async () => {
      const externalPaymentId = `pi_${uid()}`;
      createdIntents.push(externalPaymentId);
      ok(await db.from('processed_webhook_events').insert({ id: externalPaymentId }), 'event');
      return { externalPaymentId };
    });
    provider.confirmWithPaymentMethod.mockResolvedValue(intentIn('succeeded'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('review');
    expect(sentry.fingerprints).toContain('manual-charge-settled-not-confirmed');
  });

  it.each([
    {
      status: 'requires_action',
      outcome: 'in_progress',
      fingerprint: 'manual-charge-retained-intent-active',
    },
    { status: 'refunded', outcome: 'review', fingerprint: 'manual-charge-unexpected-intent' },
  ])(
    'does not charge again over a retained intent in $status',
    async ({ status, outcome, fingerprint }) => {
      // Arrange
      const bookingId = await declinedAndSpaced();
      provider.getPaymentIntent.mockResolvedValue(intentIn(status));

      // Act
      const result = await outcomeOf(bookingId);

      // Assert
      expect(result).toBe(outcome);
      expect(provider.confirmWithPaymentMethod).toHaveBeenCalledTimes(1);
      expect(provider.createPaymentSession).toHaveBeenCalledTimes(1);
      expect(sentry.fingerprints).toContain(fingerprint);
    },
  );

  it('alerts instead of promising a notice when another actor changed the booking meanwhile', async () => {
    // Arrange: la reserva se cancela entre el confirm y el registro del rechazo.
    const { bookingId } = await createDeferredBooking(db, instanceId);
    provider.confirmWithPaymentMethod.mockImplementation(async () => {
      ok(await db.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId), 'cancel');
      return intentIn('requires_payment_method');
    });

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('review');
    expect(sentry.fingerprints).toContain('manual-charge-registration-skipped');
  });
});

describe('cobro manual — rechazos terminales y avisos', () => {
  it('closes a terminal intent and refuses a new one within the hour without creating it', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    provider.confirmWithPaymentMethod.mockResolvedValueOnce(intentIn('canceled'));

    // Act
    const first = await outcomeOf(bookingId);
    const second = await outcomeOf(bookingId);

    // Assert
    expect([first, second]).toEqual(['declined', 'retry_too_soon']);
    expect(provider.createPaymentSession).toHaveBeenCalledTimes(1);
    const [payment] = await paymentsOf(db, bookingId);
    expect(payment).toMatchObject({ status: 'failed' });
    expect(payment?.provider_closed_at).not.toBeNull();
  });

  it.each([
    { status: 'requires_payment_method', kind: 'charge_failed_action_required_1' },
    { status: 'requires_action', kind: 'charge_requires_action' },
  ])('queues the $kind notice the panel promises to the staff', async ({ status, kind }) => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    provider.confirmWithPaymentMethod.mockResolvedValue(intentIn(status));

    // Act
    await outcomeOf(bookingId);

    // Assert
    expect(await notificationKinds(db, bookingId)).toContain(kind);
  });

  it('alerts when the intent it created cannot be cancelled', async () => {
    // Arrange: la salida ya empezó, así que el inicio del cobro se rechaza.
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
    provider.cancelPaymentSession.mockRejectedValue(new Error('OnvoPay cancel error 500'));

    // Act
    const outcome = await outcomeOf(bookingId);

    // Assert
    expect(outcome).toBe('departure_unavailable');
    expect(sentry.fingerprints).toContain('manual-charge-intent-not-cancelled');
  });
});
