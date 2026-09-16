// Job close-payment-intents (spec 0029 §5.9) — integración contra DB real con OnvoPay y Sentry
// simulados (charge-mocks.ts). Cada test usa su propia salida y la borra. Requiere: supabase start
// + seed.
// Excede 150 líneas: excepción de testing-practices (lógica de dinero con muchos casos).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/env.js', async () => (await import('./charge-mocks.js')).fakeEnvModule());
vi.mock('@sentry/node', async () => (await import('./charge-mocks.js')).fakeSentryModule());
vi.mock('../../src/charges/onvopay.js', async () => ({
  createOnvopayChargeClient: (await import('./charge-mocks.js')).fakeChargeClient,
}));

const { alertFor, onvo, resetChargeMocks } = await import('./charge-mocks.js');
type IntentState = import('./charge-mocks.js').IntentState;
const { closePaymentIntents } = await import('../../src/jobs/close-payment-intents.js');
const {
  auditOf,
  cancelByTourist,
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  db,
  deleteDepartures,
  deleteWebhookEvents,
  firstPayment,
  isoFromNow,
  MANDATE_CENTS,
  MANDATE_CURRENCY,
  MINUTE_MS,
  must,
  ok,
  readBooking,
  recordDecline,
  refundsOf,
  startCharge,
} = await import('./deferred-fixtures.js');

const eventIds: string[] = [];
let departure: { tourId: string; instanceId: string };

const intentIn = (status: string): IntentState => ({
  status,
  amountCents: MANDATE_CENTS,
  currency: MANDATE_CURRENCY,
});

/** Reserva diferida cancelada con su intent sin cerrar, en el estado que diga OnvoPay. */
async function cancelledWithOpenIntent(intent: IntentState | null) {
  const fixture = await createDeferredBooking(departure.instanceId);
  const intentId = await startCharge(fixture.bookingId);
  await recordDecline(fixture.bookingId, intentId);
  await cancelByTourist(fixture.bookingId);
  onvo.intents.set(intentId, intent);
  eventIds.push(intentId);
  return { ...fixture, intent: intentId };
}

function webhookConfirm(bookingId: string, intent: string) {
  return db.rpc('confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: intent,
    p_event_id: intent,
    p_paid_amount_cents: MANDATE_CENTS,
    p_paid_currency: MANDATE_CURRENCY,
  });
}

beforeEach(async () => {
  resetChargeMocks();
  departure = await createDeparture(10 * DAY_MS);
});

afterEach(async () => {
  await deleteDepartures([departure.tourId]);
  await deleteWebhookEvents(eventIds.splice(0));
});

describe('close-payment-intents — cobros que liquidaron tarde', () => {
  it('refunds a charge that settled after its booking was cancelled, once across cycles', async () => {
    // Arrange
    const { bookingId } = await cancelledWithOpenIntent(intentIn('succeeded'));

    // Act
    await closePaymentIntents();
    await closePaymentIntents();

    // Assert
    expect((await readBooking(bookingId)).status).toBe('cancelled');
    expect(await refundsOf(bookingId)).toEqual([
      { amount_cents: MANDATE_CENTS, reason: 'late_payment' },
    ]);
  });

  it('does not refund twice when the webhook settled the same late charge first', async () => {
    // Arrange
    const { bookingId, intent } = await cancelledWithOpenIntent(intentIn('succeeded'));
    const webhookOutcome = must(await webhookConfirm(bookingId, intent), 'webhook');

    // Act
    await closePaymentIntents();

    // Assert
    expect(webhookOutcome).toBe('late_payment_refunded');
    expect(await refundsOf(bookingId)).toHaveLength(1);
  });

  it('answers already_processed to a webhook that arrives after the sweep settled the charge', async () => {
    // Arrange
    const { bookingId, intent } = await cancelledWithOpenIntent(intentIn('succeeded'));
    await closePaymentIntents();

    // Act
    const webhookOutcome = must(await webhookConfirm(bookingId, intent), 'webhook');

    // Assert
    expect(webhookOutcome).toBe('already_processed');
    expect(await refundsOf(bookingId)).toHaveLength(1);
  });
});

describe('close-payment-intents — cierre de intents', () => {
  it('cancels a still confirmable intent and records the audited closure once a GET confirms it', async () => {
    // Arrange
    const { bookingId, intent } = await cancelledWithOpenIntent(
      intentIn('requires_payment_method'),
    );

    // Act
    await closePaymentIntents();
    const afterCancel = (await firstPayment(bookingId)).provider_closed_at;
    onvo.intents.set(intent, { status: 'canceled' });
    await closePaymentIntents();

    // Assert
    expect(onvo.cancelled).toEqual([intent]);
    expect(afterCancel).toBeNull();
    expect((await firstPayment(bookingId)).provider_closed_at).not.toBeNull();
    const [audit] = await auditOf(bookingId, 'charge.intent_closed');
    expect(audit?.metadata).toMatchObject({
      external_payment_id: intent,
      intent_status: 'canceled',
      previous_status: 'failed',
      source: 'close-payment-intents',
    });
  });

  it('retries on the next cycle a cancel that OnvoPay rejected', async () => {
    // Arrange
    const { intent } = await cancelledWithOpenIntent(intentIn('requires_action'));
    onvo.failCancel = true;

    // Act
    await closePaymentIntents();
    const afterFailure = [...onvo.cancelled];
    onvo.failCancel = false;
    await closePaymentIntents();

    // Assert
    expect(afterFailure).toEqual([]);
    expect(onvo.cancelled).toEqual([intent]);
  });

  it('leaves a processing intent open', async () => {
    // Arrange
    const { bookingId } = await cancelledWithOpenIntent(intentIn('processing'));

    // Act
    await closePaymentIntents();

    // Assert
    expect((await firstPayment(bookingId)).provider_closed_at).toBeNull();
    expect(onvo.cancelled).toEqual([]);
  });

  it('records an intent OnvoPay does not know (404) as closed and alerts', async () => {
    // Arrange
    const { bookingId } = await cancelledWithOpenIntent(null);

    // Act
    await closePaymentIntents();

    // Assert
    expect((await firstPayment(bookingId)).provider_closed_at).not.toBeNull();
    const [audit] = await auditOf(bookingId, 'charge.intent_closed');
    expect(audit?.metadata).toMatchObject({ intent_status: 'not_found' });
    expect(alertFor('close-payment-intents-intent-not-found')?.level).toBe('error');
  });

  it('alerts the intents that passed the closure window for the staff', async () => {
    // Arrange
    const { bookingId } = await cancelledWithOpenIntent(intentIn('processing'));
    ok(
      await db
        .from('payments')
        .update({ failed_at: isoFromNow(-8 * DAY_MS) })
        .eq('booking_id', bookingId),
      'age failed payment',
    );

    // Act
    await closePaymentIntents();

    // Assert
    expect(alertFor('close-payment-intents-past-window')?.level).toBe('error');
  });
});

describe('close-payment-intents — limpieza de customers', () => {
  async function abandonedHold(customerId: string) {
    return must(
      await db
        .from('tour_holds')
        .insert({
          tour_instance_id: departure.instanceId,
          session_token: crypto.randomUUID(),
          held_seats: 1,
          status: 'expired',
          customer_external_id: customerId,
          expires_at: isoFromNow(-MINUTE_MS),
        })
        .select('id')
        .single(),
      'hold',
    );
  }

  async function cleanedAt(holdId: string) {
    const hold = must(
      await db.from('tour_holds').select('customer_cleaned_at').eq('id', holdId).single(),
      'cleanedAt',
    );
    return hold.customer_cleaned_at;
  }

  it('detaches the card, deletes the customer of an abandoned checkout and audits it', async () => {
    // Arrange
    const customerId = `cus_${crypto.randomUUID().slice(0, 8)}`;
    const hold = await abandonedHold(customerId);
    onvo.methods.set(customerId, ['pm_abandonado']);

    // Act
    await closePaymentIntents();

    // Assert
    expect(onvo.detached).toContain('pm_abandonado');
    expect(onvo.deletedCustomers).toContain(customerId);
    expect(await cleanedAt(hold.id)).not.toBeNull();
    const [audit] = await auditOf(hold.id, 'customer.provider_deleted');
    expect(audit?.metadata).toEqual({ detached_payment_methods: 1 });
  });

  it('retries the cleanup on the next cycle when a detach failed', async () => {
    // Arrange
    const customerId = `cus_${crypto.randomUUID().slice(0, 8)}`;
    const hold = await abandonedHold(customerId);
    onvo.methods.set(customerId, ['pm_reintento']);
    onvo.failDetach = true;

    // Act
    await closePaymentIntents();
    const afterFailure = await cleanedAt(hold.id);
    onvo.failDetach = false;
    await closePaymentIntents();

    // Assert
    expect(afterFailure).toBeNull();
    expect(await cleanedAt(hold.id)).not.toBeNull();
  });

  it('keeps the customer while a cancelled booking still has an open intent', async () => {
    // Arrange
    const { customerId } = await cancelledWithOpenIntent(intentIn('processing'));

    // Act
    await closePaymentIntents();

    // Assert
    expect(onvo.deletedCustomers).not.toContain(customerId);
  });
});
