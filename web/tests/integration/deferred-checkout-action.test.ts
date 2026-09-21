// Checkout diferido en dos pasos (spec 0029 §5.2): server actions contra DB real, con OnvoPay,
// cookies, headers y locale simulados. El paso 2 revalida todo (sesión, customer de la tarjeta,
// monto autorizado y asientos) sin confiar en lo que reenvía el navegador.
// Excede 150 líneas: excepción de testing-practices (lógica de dinero con muchos casos).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import type { PaymentMethodDetails } from '@/lib/payments/types';
import { HOLD_SESSION_COOKIE } from '@shared/constants/bookings';
import { deleteToursDeep } from './cleanup';
import {
  createDeparture,
  DAY_MS,
  EXPIRED_CARD,
  must,
  ok,
  readBooking,
  readHoldStatus,
  uid,
  type Db,
} from './deferred-fixtures';

const state = vi.hoisted(() => ({ flag: 'true', cookies: new Map<string, string>() }));
const provider = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  getPaymentMethod: vi.fn(),
}));

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    env: new Proxy(actual.env, {
      get: (target, key) => {
        if (key === 'DEFERRED_CHARGE_ENABLED') return state.flag;
        // Sin throttle: el rate limit del checkout tiene su propia suite (spec 0017).
        if (key === 'RATE_LIMIT_ENABLED') return 'false';
        return Reflect.get(target, key) as unknown;
      },
    }),
  };
});
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = state.cookies.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => {
        state.cookies.set(name, value);
      },
    }),
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock('next-intl/server', () => ({ getLocale: () => Promise.resolve('es') }));
vi.mock('@/lib/payments', () => ({ getPaymentProvider: () => provider }));

const { completeDeferredCheckoutAction, startDeferredCheckoutAction } =
  await import('@/lib/booking/deferred-checkout-action');
type Started = import('@/lib/booking/deferred-checkout-action').DeferredCheckoutStarted;
type Payload = import('@/lib/booking/deferred-checkout-action').DeferredCompletePayload;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ADULT_PRICE_USD = 35;
const SEATS = 2;
const EXPECTED_CENTS = 7000;
const tourIds: string[] = [];
let instanceId: string;

function checkoutForm(overrides: Record<string, string | null> = {}): FormData {
  const values: Record<string, string | null> = {
    instance_id: instanceId,
    name: 'Turista Diferido',
    email: `checkout-${uid()}@example.com`,
    consent: 'accepted',
    adult: String(SEATS),
    child: '0',
    student: '0',
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) if (value !== null) form.set(key, value);
  return form;
}

async function startCheckout(): Promise<Started> {
  const started = await startDeferredCheckoutAction(null, checkoutForm());
  if (!started || 'error' in started) throw new Error(`start: ${JSON.stringify(started)}`);
  return started;
}

/** Tarjeta que devolvería el GET de OnvoPay; el payload usa su id salvo que se indique otro. */
function cardOf(customerId: string, overrides: Partial<PaymentMethodDetails> = {}) {
  const card: PaymentMethodDetails = {
    id: `pm_${uid()}`,
    status: 'attached',
    customerId,
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2030,
    ...overrides,
  };
  provider.getPaymentMethod.mockResolvedValue(card);
  return card;
}

function payloadFor(started: Started, paymentMethodId: string, overrides: Partial<Payload> = {}) {
  return {
    holdId: started.holdId,
    paymentMethodId,
    expectedAmountCents: started.totalAmountCents,
    fields: started.fields,
    ...overrides,
  };
}

async function bookingsForHold(holdId: string): Promise<number> {
  const { count } = await db
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('hold_id', holdId);
  return count ?? 0;
}

beforeAll(async () => {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
  ok(
    await db
      .from('tour_pricing')
      .insert({ tour_id: departure.tourId, ticket_type: 'adult', price_usd: ADULT_PRICE_USD }),
    'pricing',
  );
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

beforeEach(() => {
  vi.clearAllMocks();
  state.flag = 'true';
  state.cookies.clear();
  provider.createCustomer.mockImplementation(() => Promise.resolve({ customerId: `cus_${uid()}` }));
  provider.deleteCustomer.mockResolvedValue(undefined);
});

describe('startDeferredCheckoutAction', () => {
  it('holds the seats and stores the new OnvoPay customer on the hold without charging', async () => {
    // Act
    const started = await startCheckout();

    // Assert
    expect(started).toMatchObject({ totalAmountCents: EXPECTED_CENTS, currency: 'USD' });
    expect(started.fields.adult).toBe(SEATS);
    const hold = must(
      await db
        .from('tour_holds')
        .select('status, customer_external_id')
        .eq('id', started.holdId)
        .single(),
      'hold',
    );
    expect(hold).toEqual({ status: 'active', customer_external_id: started.customerId });
    expect(state.cookies.has(HOLD_SESSION_COOKIE)).toBe(true);
  });

  it('does nothing while the deferred charge flag is off', async () => {
    // Arrange
    state.flag = 'false';

    // Act
    const result = await startDeferredCheckoutAction(null, checkoutForm());

    // Assert
    expect(result).toEqual({ error: 'error-generic' });
    expect(provider.createCustomer).not.toHaveBeenCalled();
  });

  it('rejects a form without consent before creating a customer', async () => {
    // Act
    const result = await startDeferredCheckoutAction(null, checkoutForm({ consent: null }));

    // Assert
    expect(result).toEqual({ error: 'error-generic' });
    expect(provider.createCustomer).not.toHaveBeenCalled();
  });

  it('releases the hold when OnvoPay fails to create the customer', async () => {
    // Arrange
    provider.createCustomer.mockRejectedValue(new Error('OnvoPay createCustomer error 500'));

    // Act
    const result = await startDeferredCheckoutAction(null, checkoutForm());

    // Assert
    expect(result).toEqual({ error: 'error-generic' });
    const [latest] = must(
      await db
        .from('tour_holds')
        .select('status, customer_external_id')
        .eq('tour_instance_id', instanceId)
        .order('created_at', { ascending: false })
        .limit(1),
      'latest hold',
    );
    expect(latest).toEqual({ status: 'released', customer_external_id: null });
  });
});

describe('completeDeferredCheckoutAction — reserva creada', () => {
  it('creates a pending_minimum booking with the card data read by the server', async () => {
    // Arrange
    const started = await startCheckout();
    const card = cardOf(started.customerId);

    // Act
    const result = await completeDeferredCheckoutAction(payloadFor(started, card.id));

    // Assert
    if (!('bookingId' in result)) throw new Error(`complete: ${result.error}`);
    expect(await readBooking(db, result.bookingId)).toMatchObject({
      status: 'pending_minimum',
      total_amount_cents: EXPECTED_CENTS,
      payment_method_id: card.id,
      customer_external_id: started.customerId,
      card_last4: '4242',
    });
    expect(await readHoldStatus(db, started.holdId)).toBe('paying');
  });

  it('returns the same booking when step 2 is repeated after a lost response', async () => {
    // Arrange
    const started = await startCheckout();
    const card = cardOf(started.customerId);
    const first = await completeDeferredCheckoutAction(payloadFor(started, card.id));

    // Act
    const second = await completeDeferredCheckoutAction(payloadFor(started, card.id));

    // Assert
    expect(second).toEqual(first);
    expect(await bookingsForHold(started.holdId)).toBe(1);
    expect(provider.getPaymentMethod).toHaveBeenCalledTimes(1);
  });
});

describe('completeDeferredCheckoutAction — rechazos', () => {
  it.each([
    {
      name: 'a card from another customer',
      expected: 'card-invalid',
      card: { customerId: 'cus_ajeno' },
    },
    { name: 'a card without expiry data', expected: 'card-invalid', card: { expMonth: null } },
    { name: 'a detached card', expected: 'card-invalid', card: { status: 'detached' } },
    {
      name: 'a different card than the tokenized one',
      expected: 'card-invalid',
      card: { id: 'pm_otra' },
    },
    {
      name: 'a card that expires before the departure',
      expected: 'card-expires-before-departure',
      card: { expMonth: EXPIRED_CARD.month, expYear: EXPIRED_CARD.year },
    },
  ])('rejects $name without creating the booking', async ({ expected, card }) => {
    // Arrange
    const started = await startCheckout();
    const tokenizedId = `pm_${uid()}`;
    cardOf(started.customerId, { id: tokenizedId, ...card });

    // Act
    const result = await completeDeferredCheckoutAction(payloadFor(started, tokenizedId));

    // Assert
    expect(result).toEqual({ error: expected });
    expect(await bookingsForHold(started.holdId)).toBe(0);
    expect(await readHoldStatus(db, started.holdId)).toBe('active');
  });

  it('rejects an amount different from the one the tourist authorized', async () => {
    // Arrange: el cliente altera los tickets pero conserva el monto del mandato.
    const started = await startCheckout();
    const { id } = cardOf(started.customerId);

    // Act
    const result = await completeDeferredCheckoutAction(
      payloadFor(started, id, { fields: { ...started.fields, adult: 1 } }),
    );

    // Assert
    expect(result).toEqual({ error: 'amount-changed' });
    expect(await bookingsForHold(started.holdId)).toBe(0);
  });

  it.each([
    { name: 'the browser lost the hold cookie', cookie: null },
    { name: 'the cookie belongs to another session', cookie: 'otra-sesion' },
  ])('asks to start again without calling OnvoPay when $name', async ({ cookie }) => {
    // Arrange
    const started = await startCheckout();
    state.cookies.clear();
    if (cookie) state.cookies.set(HOLD_SESSION_COOKIE, cookie);

    // Act
    const result = await completeDeferredCheckoutAction(payloadFor(started, `pm_${uid()}`));

    // Assert
    expect(result).toEqual({ error: 'hold-expired' });
    expect(provider.getPaymentMethod).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'fields set to null', change: { fields: null } },
    { name: 'a hold id that is not a uuid', change: { holdId: 'hold-1' } },
    {
      name: 'a payment method id with a path',
      change: { paymentMethodId: '../payment-intents/pi_1' },
    },
    { name: 'a zero authorized amount', change: { expectedAmountCents: 0 } },
    {
      name: 'a departure other than the hold one',
      change: { fields: { instanceId: crypto.randomUUID() } },
    },
  ])('answers a generic or expired error to $name, without calling OnvoPay', async ({ change }) => {
    // Arrange
    const started = await startCheckout();
    const base = payloadFor(started, `pm_${uid()}`);
    const fields = change.fields === null ? null : { ...base.fields, ...change.fields };

    // Act
    const result = await completeDeferredCheckoutAction({ ...base, ...change, fields } as never);

    // Assert
    expect(['error-generic', 'hold-expired']).toContain((result as { error: string }).error);
    expect(provider.getPaymentMethod).not.toHaveBeenCalled();
    expect(await bookingsForHold(started.holdId)).toBe(0);
  });

  it('does nothing while the deferred charge flag is off', async () => {
    // Arrange
    const started = await startCheckout();
    state.flag = 'false';

    // Act
    const result = await completeDeferredCheckoutAction(payloadFor(started, `pm_${uid()}`));

    // Assert
    expect(result).toEqual({ error: 'error-generic' });
    expect(provider.getPaymentMethod).not.toHaveBeenCalled();
  });
});
