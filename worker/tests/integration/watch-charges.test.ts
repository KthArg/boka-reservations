// Job watch-charges, cobros en vuelo (spec 0029 §5.5, §5.6, §5.7) — integración contra DB real con
// OnvoPay y Sentry simulados (charge-mocks.ts). Cada test usa su propia salida y la borra: un
// cobro en vuelo de un test no se cuela en los ciclos del siguiente. Requiere: supabase start + seed.
// Excede 150 líneas: excepción de testing-practices (lógica de dinero con muchos casos).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/env.js', async () => (await import('./charge-mocks.js')).fakeEnvModule());
vi.mock('@sentry/node', async () => (await import('./charge-mocks.js')).fakeSentryModule());
vi.mock('../../src/charges/onvopay.js', async () => ({
  createOnvopayChargeClient: (await import('./charge-mocks.js')).fakeChargeClient,
}));

const { alertFor, onvo, resetChargeMocks } = await import('./charge-mocks.js');
type IntentState = import('./charge-mocks.js').IntentState;
const { watchCharges } = await import('../../src/jobs/watch-charges.js');
const {
  auditOf,
  backdateCharge,
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  db,
  deleteDepartures,
  deleteWebhookEvents,
  firstPayment,
  HOUR_MS,
  isoFromNow,
  MANDATE_CENTS,
  MANDATE_CURRENCY,
  MINUTE_MS,
  ok,
  paymentsOf,
  readBooking,
  startCharge,
  startDepartureNow,
  updateBooking,
} = await import('./deferred-fixtures.js');

const PAST_GRACE_MS = 31 * MINUTE_MS;
const eventIds: string[] = [];
let departure: { tourId: string; instanceId: string };

const intentIn = (status: string): IntentState => ({
  status,
  amountCents: MANDATE_CENTS,
  currency: MANDATE_CURRENCY,
});

/** Cobro en vuelo iniciado antes de la gracia del watchdog, con el intent en el estado dado. */
async function inFlightCharge(intent: IntentState | null) {
  const { bookingId } = await createDeferredBooking(departure.instanceId);
  const intentId = await startCharge(bookingId);
  await backdateCharge(bookingId, PAST_GRACE_MS);
  onvo.intents.set(intentId, intent);
  eventIds.push(intentId);
  return { bookingId, intent: intentId };
}

beforeEach(async () => {
  resetChargeMocks();
  departure = await createDeparture(10 * DAY_MS);
});

afterEach(async () => {
  await deleteDepartures([departure.tourId]);
  await deleteWebhookEvents(eventIds.splice(0));
});

describe('watch-charges — lo que dice el GET', () => {
  it('confirms a charge whose intent succeeded but whose webhook never arrived', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge(intentIn('succeeded'));

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('confirmed');
    expect((await paymentsOf(bookingId)).map((p) => p.status)).toEqual(['succeeded']);
  });

  it('leaves a recent charge to whoever started it', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    const intent = await startCharge(bookingId);
    onvo.intents.set(intent, intentIn('succeeded'));

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('pending_payment');
  });

  it('retries on the next cycle when reading the intent failed', async () => {
    // Arrange
    const { bookingId, intent } = await inFlightCharge(intentIn('succeeded'));
    onvo.failingGets.add(intent);

    // Act
    await watchCharges();
    const afterFailure = (await readBooking(bookingId)).status;
    onvo.failingGets.clear();
    await watchCharges();

    // Assert
    expect(afterFailure).toBe('pending_payment');
    expect((await readBooking(bookingId)).status).toBe('confirmed');
  });

  it('flags a settled charge whose amount does not match the mandate', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge({
      status: 'succeeded',
      amountCents: MANDATE_CENTS + 100,
      currency: MANDATE_CURRENCY,
    });

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('payment_mismatch');
    expect(alertFor('watch-charges-mismatch')?.level).toBe('error');
  });

  it('never settles a charge whose GET has no amount', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge({ status: 'succeeded' });

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('pending_payment');
    expect(alertFor('watch-charges-unverifiable')?.level).toBe('error');
  });

  it('alerts a charge stuck in processing for more than 24 hours without touching it', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge(intentIn('processing'));
    await backdateCharge(bookingId, 25 * HOUR_MS);

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('pending_payment');
    expect(alertFor('watch-charges-stuck-processing')?.level).toBe('error');
  });

  it('alerts and never acts on an intent in an unexpected state', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge(intentIn('refunded'));

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('pending_payment');
    expect(alertFor('watch-charges-unexpected-intent')?.level).toBe('error');
  });

  it('records an intent OnvoPay does not know (404) as closed and alerts', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge(null);

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('pending_minimum');
    const payment = await firstPayment(bookingId);
    expect(payment.status).toBe('failed');
    expect(payment.provider_closed_at).not.toBeNull();
    expect(alertFor('watch-charges-intent-not-found')?.level).toBe('error');
  });
});

describe('watch-charges — 3DS y rechazos', () => {
  it('registers a 3DS nobody recorded and queues the authentication link', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge(intentIn('requires_action'));

    // Act
    await watchCharges();

    // Assert
    const booking = await readBooking(bookingId);
    expect(booking.status).toBe('pending_payment');
    expect(booking.awaiting_action_until).not.toBeNull();
    const { data: notifications } = await db
      .from('notifications')
      .select('kind')
      .eq('booking_id', bookingId)
      .eq('kind', 'charge_requires_action');
    expect(notifications).toHaveLength(1);
  });

  it('cancels an expired 3DS and cancels its intent at OnvoPay', async () => {
    // Arrange
    const { bookingId, intent } = await inFlightCharge(intentIn('requires_action'));
    ok(
      await db.rpc('charge_requires_action', {
        p_booking_id: bookingId,
        p_external_payment_id: intent,
      }),
      '3ds',
    );
    await updateBooking(bookingId, { awaiting_action_until: isoFromNow(-MINUTE_MS) });

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('cancelled');
    const payment = await firstPayment(bookingId);
    expect(payment.status).toBe('failed');
    expect(payment.provider_closed_at).toBeNull();
    expect(onvo.cancelled).toEqual([intent]);
  });

  it('records a decline and schedules the retry on the same intent', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge(intentIn('requires_payment_method'));

    // Act
    await watchCharges();

    // Assert
    const booking = await readBooking(bookingId);
    expect(booking).toMatchObject({
      status: 'pending_minimum',
      charge_attempts: 1,
      charge_last_error: 'intent_requires_payment_method',
    });
    expect(booking.charge_next_attempt_at).not.toBeNull();
    expect((await paymentsOf(bookingId)).map((p) => p.status)).toEqual(['pending']);
  });

  it('records a canceled intent as terminal and closes its payment', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge(intentIn('canceled'));

    // Act
    await watchCharges();

    // Assert
    const payment = await firstPayment(bookingId);
    expect(payment.status).toBe('failed');
    expect(payment.provider_closed_at).not.toBeNull();
  });

  it('is idempotent: a second cycle does not record the decline again', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge(intentIn('requires_payment_method'));

    // Act
    await watchCharges();
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).charge_attempts).toBe(1);
  });
});

describe('watch-charges — cobros en vuelo con plazos vencidos', () => {
  it.each([
    ['departure_started', () => startDepartureNow(departure.instanceId)],
    [
      'recovery_expired',
      (bookingId: string) =>
        updateBooking(bookingId, { recovery_deadline: isoFromNow(-MINUTE_MS) }),
    ],
  ] as const)('cancels a declined charge in flight with reason %s', async (reason, expire) => {
    // Arrange
    const { bookingId, intent } = await inFlightCharge(intentIn('requires_payment_method'));
    await expire(bookingId);

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('cancelled');
    const [audit] = await auditOf(bookingId, 'booking.charge_cancelled');
    expect(audit?.metadata).toMatchObject({ reason });
    expect(onvo.cancelled).toEqual([intent]);
  });

  it('keeps the cancellation and alerts when OnvoPay rejects cancelling the intent', async () => {
    // Arrange
    const { bookingId } = await inFlightCharge(intentIn('requires_payment_method'));
    await updateBooking(bookingId, { recovery_deadline: isoFromNow(-MINUTE_MS) });
    onvo.failCancel = true;

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('cancelled');
    expect((await firstPayment(bookingId)).provider_closed_at).toBeNull();
    expect(alertFor('watch-charges-cancel-intent-failed')).toBeDefined();
  });
});
