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
  authorizeCharge,
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

/**
 * Plazo de recuperación vencido. Lleva `charge_attempts` porque ese plazo solo existe después de
 * un rechazo: el barrido se acota a las reservas que ya fallaron (spec 0033 §5.9).
 */
const expireRecovery = (bookingId: string) =>
  updateBooking(bookingId, { recovery_deadline: isoFromNow(-MINUTE_MS), charge_attempts: 1 });

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

  // El motor del mínimo (spec 0033) le copia su plazo a la reserva; este job NO está detrás del
  // flag, así que sin el filtro por intentos cancelaría reservas que nunca se intentaron cobrar.
  it('leaves an expired deadline alone while the booking never failed a charge', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    await updateBooking(bookingId, { recovery_deadline: isoFromNow(-MINUTE_MS) });

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('pending_minimum');
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

  // Una autorización viva (spec 0033) tiene su propio plazo, el del ciclo del mínimo: el plazo de
  // recuperación del cobro manual no la toca. La red terminal de la salida empezada sí.
  it('leaves a live authorization to the minimum cycle even with the recovery deadline passed', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    const intent = await authorizeCharge(bookingId);
    onvo.intents.set(intent, intentIn('requires_capture'));
    eventIds.push(intent);
    await updateBooking(bookingId, { recovery_deadline: isoFromNow(-MINUTE_MS) });

    // Act
    await watchCharges();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('pending_payment');
    expect(onvo.cancelled).toEqual([]);
  });

  it('releases and cancels an authorized booking once its departure started', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    const intent = await authorizeCharge(bookingId);
    onvo.intents.set(intent, intentIn('requires_capture'));
    eventIds.push(intent);
    await startDepartureNow(departure.instanceId);

    // Act
    await watchCharges();

    // Assert
    const booking = await readBooking(bookingId);
    expect(booking.status).toBe('cancelled');
    expect(booking.authorized_at).toBeNull();
    expect(onvo.cancelled).toEqual([intent]);
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
