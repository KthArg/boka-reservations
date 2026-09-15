// Actualización de la tarjeta de una reserva sin cobrar (spec 0029 §5.2, §5.7): server action
// contra DB real, con OnvoPay simulado. Mismas reglas que el checkout, y la tarjeta reemplazada se
// desvincula.
// Excede 150 líneas: excepción de testing-practices (lógica de dinero con muchos casos).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import type { PaymentMethodDetails } from '@/lib/payments/types';
import { hashBookingToken } from '@/lib/booking/booking-token-hash';
import { deleteToursDeep } from './cleanup';
import {
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  EXPIRED_CARD,
  failCharge,
  isoFromNow,
  ok,
  paymentsOf,
  readBooking,
  startCharge,
  startChargeOutcome,
  uid,
  type Db,
} from './deferred-fixtures';

const provider = vi.hoisted(() => ({ getPaymentMethod: vi.fn(), detachPaymentMethod: vi.fn() }));
vi.mock('@/lib/payments', () => ({ getPaymentProvider: () => provider }));
// Sin el throttle del enlace mágico: la suite valida muchos tokens seguidos (spec 0028, B10).
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    env: new Proxy(actual.env, {
      get: (target, key) =>
        key === 'RATE_LIMIT_ENABLED' ? 'false' : (Reflect.get(target, key) as unknown),
    }),
  };
});

const { updateCardAction } = await import('@/lib/booking/card-update-action');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CARD_UPDATE_LIMIT = 5;
const tourIds: string[] = [];
let instanceId: string;

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

/** Reserva sin cobrar con un rechazo registrado: el caso del enlace del aviso. */
async function declinedBooking() {
  const { bookingId, hold } = await createDeferredBooking(db, instanceId);
  await failCharge(db, bookingId, await startCharge(db, bookingId));
  return { bookingId, customerId: hold.customerId, token: await accessTokenFor(bookingId) };
}

/** La tarjeta que devolvería el GET de OnvoPay. */
function newCard(customerId: string, overrides: Partial<PaymentMethodDetails> = {}) {
  const card: PaymentMethodDetails = {
    id: `pm_${uid()}`,
    status: 'attached',
    customerId,
    brand: 'mastercard',
    last4: '5454',
    expMonth: 11,
    expYear: 2031,
    ...overrides,
  };
  provider.getPaymentMethod.mockResolvedValue(card);
  return card;
}

beforeAll(async () => {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

beforeEach(() => {
  vi.clearAllMocks();
  provider.detachPaymentMethod.mockResolvedValue(undefined);
});

describe('updateCardAction — tarjeta aceptada', () => {
  it('saves the new card, detaches the replaced one and schedules the next attempt', async () => {
    // Arrange
    const { bookingId, customerId, token } = await declinedBooking();
    const { payment_method_id: previous } = await readBooking(db, bookingId);
    const card = newCard(customerId);

    // Act
    const result = await updateCardAction({
      token,
      paymentMethodId: card.id,
      mandateAccepted: true,
    });

    // Assert
    expect(result).toEqual({ ok: true });
    const booking = await readBooking(db, bookingId);
    expect(booking).toMatchObject({ payment_method_id: card.id, card_last4: '5454' });
    expect(booking.charge_next_attempt_at).not.toBeNull();
    expect(provider.detachPaymentMethod).toHaveBeenCalledWith(previous);
  });

  it('keeps the saved card untouched when the tourist submits the same one', async () => {
    // Arrange
    const { bookingId, customerId, token } = await declinedBooking();
    const { payment_method_id: current } = await readBooking(db, bookingId);
    newCard(customerId, { id: current as string, last4: '4242' });

    // Act
    const result = await updateCardAction({
      token,
      paymentMethodId: current as string,
      mandateAccepted: true,
    });

    // Assert
    expect(result).toEqual({ ok: true });
    expect(provider.detachPaymentMethod).not.toHaveBeenCalled();
  });
});

describe('updateCardAction — rechazos', () => {
  // Una tarjeta ajena o ya desvinculada no se toca; una nuestra que las reglas rechazan se desvincula.
  it.each([
    {
      name: 'a card from another customer',
      expected: 'card-invalid',
      card: { customerId: 'cus_ajeno' },
      detachesNewCard: false,
    },
    {
      name: 'a detached card',
      expected: 'card-invalid',
      card: { status: 'detached' },
      detachesNewCard: false,
    },
    {
      name: 'a card without expiry data',
      expected: 'card-invalid',
      card: { expYear: null },
      detachesNewCard: true,
    },
    {
      name: 'a card that expires before the departure',
      expected: 'card-expires-before-departure',
      card: { expMonth: EXPIRED_CARD.month, expYear: EXPIRED_CARD.year },
      detachesNewCard: true,
    },
  ])('rejects $name and keeps the saved card', async ({ expected, card, detachesNewCard }) => {
    // Arrange
    const { bookingId, customerId, token } = await declinedBooking();
    const { id } = newCard(customerId, card);

    // Act
    const result = await updateCardAction({ token, paymentMethodId: id, mandateAccepted: true });

    // Assert
    expect(result).toEqual({ ok: false, error: expected });
    expect((await readBooking(db, bookingId)).card_last4).toBe('4242');
    if (detachesNewCard) expect(provider.detachPaymentMethod).toHaveBeenCalledWith(id);
    else expect(provider.detachPaymentMethod).not.toHaveBeenCalled();
  });

  it('rejects a card that already backs another live booking', async () => {
    // Arrange
    const other = await createDeferredBooking(db, instanceId);
    const { payment_method_id: taken } = await readBooking(db, other.bookingId);
    const { customerId, token } = await declinedBooking();
    newCard(customerId, { id: taken as string });

    // Act
    const result = await updateCardAction({
      token,
      paymentMethodId: taken as string,
      mandateAccepted: true,
    });

    // Assert
    expect(result).toEqual({ ok: false, error: 'card-in-use' });
  });

  it('stops accepting cards after the limit of changes', async () => {
    // Arrange
    const { customerId, token } = await declinedBooking();
    for (let change = 0; change < CARD_UPDATE_LIMIT; change += 1) {
      const { id } = newCard(customerId);
      const accepted = await updateCardAction({
        token,
        paymentMethodId: id,
        mandateAccepted: true,
      });
      expect(accepted).toEqual({ ok: true });
    }
    const { id } = newCard(customerId);

    // Act
    const result = await updateCardAction({ token, paymentMethodId: id, mandateAccepted: true });

    // Assert
    expect(result).toEqual({ ok: false, error: 'card-update-limit' });
  });

  it('does not change the card while a charge is in flight', async () => {
    // Arrange
    const { bookingId, customerId, token } = await declinedBooking();
    const { payment_method_id: current } = await readBooking(db, bookingId);
    const [retained] = await paymentsOf(db, bookingId);
    expect(await startChargeOutcome(db, bookingId, retained.external_payment_id)).toBe('started');
    const { id } = newCard(customerId);

    // Act
    const result = await updateCardAction({ token, paymentMethodId: id, mandateAccepted: true });

    // Assert
    expect(result).toEqual({ ok: false, error: 'card-unavailable' });
    expect((await readBooking(db, bookingId)).payment_method_id).toBe(current);
  });

  it.each([
    {
      name: 'an invalid token',
      token: 'no-existe',
      paymentMethodId: 'pm_valido',
      expected: 'card-unavailable',
    },
    {
      name: 'a payment method id with a path',
      token: null,
      paymentMethodId: '../payment-intents/pi_1',
      expected: 'error-generic',
    },
  ])(
    'answers $expected to $name without calling OnvoPay',
    async ({ token, paymentMethodId, expected }) => {
      // Arrange
      const booking = await declinedBooking();

      // Act
      const result = await updateCardAction({
        token: token ?? booking.token,
        paymentMethodId,
        mandateAccepted: true,
      });

      // Assert
      expect(result).toEqual({ ok: false, error: expected });
      expect(provider.getPaymentMethod).not.toHaveBeenCalled();
    },
  );
});

describe('updateCardAction — mandato y efectos laterales', () => {
  it('keeps the new card when detaching the replaced one fails', async () => {
    // Arrange
    const { bookingId, customerId, token } = await declinedBooking();
    provider.detachPaymentMethod.mockRejectedValue(new Error('OnvoPay detach error 500'));
    const card = newCard(customerId);

    // Act
    const result = await updateCardAction({
      token,
      paymentMethodId: card.id,
      mandateAccepted: true,
    });

    // Assert
    expect(result).toEqual({ ok: true });
    expect((await readBooking(db, bookingId)).payment_method_id).toBe(card.id);
  });

  it('detaches a new card that the booking rules reject', async () => {
    // Arrange
    const { customerId, token } = await declinedBooking();
    const card = newCard(customerId, { expMonth: EXPIRED_CARD.month, expYear: EXPIRED_CARD.year });

    // Act
    await updateCardAction({ token, paymentMethodId: card.id, mandateAccepted: true });

    // Assert
    expect(provider.detachPaymentMethod).toHaveBeenCalledWith(card.id);
  });

  it('requires the accepted mandate before reading the card', async () => {
    // Arrange
    const { customerId, token } = await declinedBooking();
    const card = newCard(customerId);

    // Act
    const result = await updateCardAction({
      token,
      paymentMethodId: card.id,
      mandateAccepted: false,
    } as never);

    // Assert
    expect(result).toEqual({ ok: false, error: 'error-generic' });
    expect(provider.getPaymentMethod).not.toHaveBeenCalled();
  });

  it('does not change the card of a cancelled booking', async () => {
    // Arrange
    const { bookingId, customerId, token } = await declinedBooking();
    ok(
      await db.rpc('cancel_unpaid_booking', {
        p_booking_id: bookingId,
        p_actor_id: null,
        p_reason: 'customer_request',
      }),
      'cancel',
    );
    const card = newCard(customerId);

    // Act
    const result = await updateCardAction({
      token,
      paymentMethodId: card.id,
      mandateAccepted: true,
    });

    // Assert
    expect(result).toEqual({ ok: false, error: 'card-unavailable' });
    expect(provider.getPaymentMethod).not.toHaveBeenCalled();
  });
});
