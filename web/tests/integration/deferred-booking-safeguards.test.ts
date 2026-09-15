// Salvaguardas del cobro diferido agregadas tras la auditoría de pagos (spec 0029 §5.2, §5.7, §5.9;
// migración …044): separación mínima entre intentos, tope de cambios de tarjeta, cierres auditados
// del barrido, un customer por hold y avisos de cobro cancelados en un mismatch. Llama las
// funciones SQL directo con service_role.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';
import {
  auditEntries,
  cancelledWithUnclosedIntent,
  createActiveHold,
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  elapseRetrySpacing,
  failCharge,
  MANDATE_CENTS,
  MANDATE_CURRENCY,
  must,
  notificationStatus,
  paymentsOf,
  readBooking,
  startCharge,
  startChargeOutcome,
  uid,
  type Db,
} from './deferred-fixtures';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CARD_UPDATE_LIMIT = 5;
const tourIds: string[] = [];
const eventIds: string[] = [];
let instanceId: string;

function updateCard(bookingId: string, customerId: string, last4: string) {
  return db.rpc('update_booking_payment_method', {
    p_booking_id: bookingId,
    p_customer_external_id: customerId,
    p_payment_method_id: `pm_${uid()}`,
    p_card_brand: 'visa',
    p_card_last4: last4,
    p_card_exp_month: 12,
    p_card_exp_year: 2030,
  });
}

beforeAll(async () => {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
  if (eventIds.length > 0) await db.from('processed_webhook_events').delete().in('id', eventIds);
});

describe('charge_booking_start — separación mínima entre intentos', () => {
  it('rejects a new attempt within an hour of the previous one and allows it afterwards', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    const intent = await startCharge(db, bookingId);
    await failCharge(db, bookingId, intent);
    const { payment_method_id: paymentMethodId } = await readBooking(db, bookingId);

    // Act
    const tooSoon = must(
      await db.rpc('charge_booking_start', {
        p_booking_id: bookingId,
        p_external_payment_id: intent,
        p_payment_method_id: paymentMethodId as string,
      }),
      'rpc',
    );
    await elapseRetrySpacing(db, bookingId);
    const afterSpacing = await startChargeOutcome(db, bookingId, intent);

    // Assert
    expect(tooSoon).toBe('retry_too_soon');
    expect(afterSpacing).toBe('started');
  });
});

describe('update_booking_payment_method — tope de cambios de tarjeta', () => {
  it('rejects the card change after the limit and keeps the last accepted card', async () => {
    // Arrange
    const { bookingId, hold } = await createDeferredBooking(db, instanceId);
    for (let change = 0; change < CARD_UPDATE_LIMIT; change += 1) {
      must(await updateCard(bookingId, hold.customerId, `100${change}`), `change ${change}`);
    }

    // Act
    const outcome = must(await updateCard(bookingId, hold.customerId, '9999'), 'rpc');

    // Assert
    expect(outcome).toBe('update_limit_reached');
    expect((await readBooking(db, bookingId)).card_last4).toBe(`100${CARD_UPDATE_LIMIT - 1}`);
  });
});

describe('record_intent_closed — cierre del barrido', () => {
  it('closes the unclosed intent of a cancelled deferred booking and audits it once', async () => {
    // Arrange
    const { bookingId, intent } = await cancelledWithUnclosedIntent(db, instanceId);
    const [payment] = await paymentsOf(db, bookingId);

    // Act
    const first = must(
      await db.rpc('record_intent_closed', {
        p_payment_id: payment.id,
        p_intent_status: 'canceled',
      }),
      'first',
    );
    const second = must(
      await db.rpc('record_intent_closed', {
        p_payment_id: payment.id,
        p_intent_status: 'canceled',
      }),
      'second',
    );

    // Assert
    expect([first, second]).toEqual([true, false]);
    const [closed] = await paymentsOf(db, bookingId);
    expect(closed.provider_closed_at).not.toBeNull();
    const audits = await auditEntries(db, bookingId, 'charge.intent_closed');
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({
      external_payment_id: intent,
      previous_status: 'failed',
      intent_status: 'canceled',
    });
  });

  it('does not close the retained intent of a booking that is still unpaid', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    const intent = await startCharge(db, bookingId);
    await failCharge(db, bookingId, intent);
    const [payment] = await paymentsOf(db, bookingId);

    // Act
    const closed = must(
      await db.rpc('record_intent_closed', {
        p_payment_id: payment.id,
        p_intent_status: 'failed',
      }),
      'rpc',
    );

    // Assert
    expect(closed).toBe(false);
    expect((await paymentsOf(db, bookingId))[0]).toMatchObject({
      status: 'pending',
      provider_closed_at: null,
    });
  });

  it('rejects a status that does not prove the intent is closed', async () => {
    // Arrange
    const { bookingId } = await cancelledWithUnclosedIntent(db, instanceId);
    const [payment] = await paymentsOf(db, bookingId);

    // Act
    const { error } = await db.rpc('record_intent_closed', {
      p_payment_id: payment.id,
      p_intent_status: 'requires_action' as 'canceled',
    });

    // Assert
    expect(error?.message).toContain('INVALID_INTENT_STATUS');
  });
});

describe('record_customer_cleaned y un customer por hold', () => {
  it('marks the hold and audits the deletion once', async () => {
    // Arrange
    const hold = await createActiveHold(db, instanceId);

    // Act
    const first = must(
      await db.rpc('record_customer_cleaned', { p_hold_id: hold.holdId, p_detached_count: 2 }),
      'first',
    );
    const second = must(
      await db.rpc('record_customer_cleaned', { p_hold_id: hold.holdId, p_detached_count: 2 }),
      'second',
    );

    // Assert
    expect([first, second]).toEqual([true, false]);
    const audits = await auditEntries(db, hold.holdId, 'customer.provider_deleted');
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual({ detached_payment_methods: 2 });
  });

  it('rejects a second hold for the same OnvoPay customer', async () => {
    // Arrange
    const hold = await createActiveHold(db, instanceId);

    // Act
    const { error } = await db.from('tour_holds').insert({
      tour_instance_id: instanceId,
      session_token: crypto.randomUUID(),
      held_seats: 1,
      customer_external_id: hold.customerId,
    });

    // Assert
    expect(error?.code).toBe('23505');
  });
});

describe('payment_mismatch — avisos de cobro', () => {
  it('cancels the pending decline notice when confirm_booking flags a mismatch', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    const intent = await startCharge(db, bookingId);
    await failCharge(db, bookingId, intent);
    eventIds.push(intent);

    // Act
    const outcome = must(
      await db.rpc('confirm_booking', {
        p_booking_id: bookingId,
        p_external_payment_id: intent,
        p_event_id: intent,
        p_paid_amount_cents: MANDATE_CENTS + 1,
        p_paid_currency: MANDATE_CURRENCY,
      }),
      'rpc',
    );

    // Assert
    expect(outcome).toBe('payment_mismatch');
    expect(
      await notificationStatus(db, bookingId, 'charge_failed_action_required_1'),
    ).toMatchObject({ status: 'cancelled', cancelled_reason: 'payment_mismatch' });
  });

  it('cancels the pending reservation notice when a caller flags the mismatch', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);

    // Act
    must(
      await db.rpc('flag_payment_mismatch', {
        p_booking_id: bookingId,
        p_paid_amount_cents: MANDATE_CENTS + 1,
        p_paid_currency: MANDATE_CURRENCY,
        p_source: 'webhook',
      }),
      'rpc',
    );

    // Assert
    expect(await notificationStatus(db, bookingId, 'booking_reserved')).toMatchObject({
      status: 'cancelled',
      cancelled_reason: 'payment_mismatch',
    });
  });
});
