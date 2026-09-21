// Job watch-charges, reservas sin cobrar con plazo vencido o salida empezada (spec 0029 §5.5, §5.7,
// §5.9) — integración contra DB real con OnvoPay y Sentry simulados (charge-mocks.ts). Una reserva
// que conserva un intent no se cancela sin mirar el GET. Requiere: supabase start + seed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/env.js', async () => (await import('./charge-mocks.js')).fakeEnvModule());
vi.mock('@sentry/node', async () => (await import('./charge-mocks.js')).fakeSentryModule());
vi.mock('../../src/charges/onvopay.js', async () => ({
  createOnvopayChargeClient: (await import('./charge-mocks.js')).fakeChargeClient,
}));

const { alertFor, envState, onvo, resetChargeMocks } = await import('./charge-mocks.js');
type IntentState = import('./charge-mocks.js').IntentState;
const { watchCharges } = await import('../../src/jobs/watch-charges.js');
const {
  auditOf,
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  db,
  deleteDepartures,
  deleteWebhookEvents,
  isoFromNow,
  MANDATE_CENTS,
  MANDATE_CURRENCY,
  MINUTE_MS,
  readBooking,
  recordDecline,
  startCharge,
  startDepartureNow,
  updateBooking,
} = await import('./deferred-fixtures.js');

const eventIds: string[] = [];
let departure: { tourId: string; instanceId: string };

const intentIn = (status: string): IntentState => ({
  status,
  amountCents: MANDATE_CENTS,
  currency: MANDATE_CURRENCY,
});

const expireRecovery = (bookingId: string) =>
  updateBooking(bookingId, { recovery_deadline: isoFromNow(-MINUTE_MS) });

/** Rechazo registrado que conserva su intent para reintentar, con el plazo ya vencido. */
async function expiredWithRetainedIntent(intent: IntentState | null) {
  const { bookingId } = await createDeferredBooking(departure.instanceId);
  const intentId = await startCharge(bookingId);
  await recordDecline(bookingId, intentId);
  await expireRecovery(bookingId);
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

describe('watch-charges — reservas sin intent', () => {
  it('cancels an unpaid booking whose recovery deadline passed and releases its hold', async () => {
    // Arrange
    const { bookingId, holdId } = await createDeferredBooking(departure.instanceId);
    await expireRecovery(bookingId);

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('cancelled');
    const { data: hold } = await db.from('tour_holds').select('status').eq('id', holdId).single();
    expect(hold?.status).toBe('released');
  });

  it('cancels the unpaid bookings of a departure that already started', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    await startDepartureNow(departure.instanceId);

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('cancelled');
    const [audit] = await auditOf(bookingId, 'booking.cancelled');
    expect(audit?.metadata).toMatchObject({ reason: 'departure_started' });
  });
});

describe('watch-charges — reservas que conservan un intent', () => {
  it('confirms instead of cancelling when the retained intent settled', async () => {
    // Arrange
    const { bookingId } = await expiredWithRetainedIntent(intentIn('succeeded'));

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('confirmed');
  });

  it('waits while the retained intent is still processing', async () => {
    // Arrange
    const { bookingId } = await expiredWithRetainedIntent(intentIn('processing'));

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('pending_minimum');
  });

  it('cancels the booking and the still confirmable intent at OnvoPay', async () => {
    // Arrange
    const { bookingId, intent } = await expiredWithRetainedIntent(
      intentIn('requires_payment_method'),
    );

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('cancelled');
    expect(onvo.cancelled).toEqual([intent]);
  });

  it('cancels without calling OnvoPay when the retained intent does not exist there', async () => {
    // Arrange
    const { bookingId } = await expiredWithRetainedIntent(null);

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('cancelled');
    expect(onvo.cancelled).toEqual([]);
    expect(alertFor('watch-charges-intent-not-found')?.level).toBe('error');
  });

  it('without the OnvoPay key still cancels bookings without an intent, and never blindly the rest', async () => {
    // Arrange
    envState.secretKey = undefined;
    const withoutIntent = await createDeferredBooking(departure.instanceId);
    await expireRecovery(withoutIntent.bookingId);
    const withIntent = await expiredWithRetainedIntent(intentIn('succeeded'));

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(withoutIntent.bookingId)).status).toBe('cancelled');
    expect((await readBooking(withIntent.bookingId)).status).toBe('pending_minimum');
  });
});
