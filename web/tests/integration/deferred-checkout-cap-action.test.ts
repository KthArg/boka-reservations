// Tope de cupos y límites por IP en las acciones del checkout diferido (spec 0048 §5.1–§5.2):
// el paso 1 corta antes de apartar si el email ya está en el tope, el paso 2 rechaza y libera el
// apartado, y el paso 2 tiene su propio límite por IP. Server actions contra DB real, con OnvoPay,
// cookies, headers y locale simulados (mismo armado que deferred-checkout-action.test.ts).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import type { PaymentMethodDetails } from '@/lib/payments/types';
import { DEFERRED_MAX_LIVE_SEATS_PER_IDENTITY } from '@shared/constants/bookings';
import { RATE_LIMITS, RATE_LIMIT_KEY_PREFIX } from '@shared/constants/rate-limit';
import { rateLimitKey } from '@/lib/security/rate-limit-key';
import { deleteToursDeep } from './cleanup';
import {
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  HOLD_SEATS,
  ok,
  readHoldStatus,
  uid,
  randomCardExpiry,
  type Db,
  randomLast4,
  uniqueCardBrand,
} from './deferred-fixtures';

const state = vi.hoisted(() => ({
  rateLimit: 'false',
  ip: '203.0.113.1',
  cookies: new Map<string, string>(),
}));
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
        if (key === 'DEFERRED_CHARGE_ENABLED') return 'true';
        if (key === 'RATE_LIMIT_ENABLED') return state.rateLimit;
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
  // Una IP propia por caso: el store de rate limit es real y persiste entre corridas.
  headers: () => Promise.resolve(new Headers({ 'x-vercel-forwarded-for': state.ip })),
}));
vi.mock('next-intl/server', () => ({ getLocale: () => Promise.resolve('es') }));
vi.mock('@/lib/payments', () => ({ getPaymentProvider: () => provider }));

const { completeDeferredCheckoutAction, startDeferredCheckoutAction } =
  await import('@/lib/booking/deferred-checkout-action');
type Started = import('@/lib/booking/deferred-checkout-action').DeferredCheckoutStarted;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ADULT_PRICE_USD = 35;
const BOOKINGS_TO_FILL_CAP = DEFERRED_MAX_LIVE_SEATS_PER_IDENTITY / HOLD_SEATS;
const IP_OCTET = 250;
const ROOMY_CAPACITY = 200;
const tourIds: string[] = [];
let instanceId: string;

const newEmail = () => `tope-accion-${uid()}@example.com`;
const randomIp = () =>
  `198.51.${Math.floor(Math.random() * IP_OCTET)}.${Math.floor(Math.random() * IP_OCTET)}`;

function checkoutForm(email: string): FormData {
  const form = new FormData();
  const values: Record<string, string> = {
    instance_id: instanceId,
    name: 'Turista Tope',
    email,
    terms: 'accepted',
    privacy_consent: 'accepted',
    adult: String(HOLD_SEATS),
    child: '0',
    student: '0',
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

async function startCheckout(email = newEmail()): Promise<Started> {
  const started = await startDeferredCheckoutAction(null, checkoutForm(email));
  if (!started || 'error' in started) throw new Error(`start: ${JSON.stringify(started)}`);
  return started;
}

/** Tarjeta que devolvería el GET de OnvoPay, con marca propia (no se suma con otras). */
function cardOf(customerId: string, overrides: Partial<PaymentMethodDetails> = {}) {
  const { month, year } = randomCardExpiry();
  const card: PaymentMethodDetails = {
    id: `pm_${uid()}`,
    status: 'attached',
    customerId,
    brand: uniqueCardBrand(),
    last4: randomLast4(),
    expMonth: month,
    expYear: year,
    ...overrides,
  };
  provider.getPaymentMethod.mockResolvedValue(card);
  return card;
}

function payloadFor(started: Started, paymentMethodId: string) {
  return {
    holdId: started.holdId,
    paymentMethodId,
    expectedAmountCents: started.totalAmountCents,
    fields: started.fields,
  };
}

/** Llena el tope de la tarjeta con reservas de otros emails, creadas directo en la base. */
async function fillCardCap(card: PaymentMethodDetails): Promise<void> {
  for (let i = 0; i < BOOKINGS_TO_FILL_CAP; i += 1) {
    await createDeferredBooking(db, instanceId, {
      p_customer_email: newEmail(),
      p_card_brand: card.brand,
      p_card_last4: card.last4 as string,
    });
  }
}

beforeAll(async () => {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
  // Holgura: los casos del tope y del techo diario dejan muchos apartados vivos en esta salida.
  ok(
    await db.from('tour_instances').update({ capacity_total: ROOMY_CAPACITY }).eq('id', instanceId),
    'capacity',
  );
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
  state.rateLimit = 'false';
  state.ip = randomIp();
  state.cookies.clear();
  provider.createCustomer.mockImplementation(() => Promise.resolve({ customerId: `cus_${uid()}` }));
  provider.deleteCustomer.mockResolvedValue(undefined);
});

describe('paso 1 — chequeo temprano del tope por email', () => {
  it('rejects before holding seats or creating the OnvoPay customer', async () => {
    // Arrange
    const email = newEmail();
    for (let i = 0; i < BOOKINGS_TO_FILL_CAP; i += 1) {
      await createDeferredBooking(db, instanceId, {
        p_customer_email: email,
        p_card_last4: randomLast4(),
      });
    }
    const { count: holdsBefore } = await db
      .from('tour_holds')
      .select('id', { count: 'exact', head: true })
      .eq('tour_instance_id', instanceId);

    // Act
    const result = await startDeferredCheckoutAction(null, checkoutForm(email));

    // Assert
    expect(result).toEqual({ error: 'deferred-cap-exceeded' });
    expect(provider.createCustomer).not.toHaveBeenCalled();
    const { count: holdsAfter } = await db
      .from('tour_holds')
      .select('id', { count: 'exact', head: true })
      .eq('tour_instance_id', instanceId);
    expect(holdsAfter).toBe(holdsBefore);
  });
});

describe('paso 2 — tope por tarjeta', () => {
  it('rejects the booking and releases the hold so the seats are free again', async () => {
    // Arrange: la tarjeta ya respalda el tope en reservas de otros emails.
    const started = await startCheckout();
    const card = cardOf(started.customerId);
    await fillCardCap(card);

    // Act
    const result = await completeDeferredCheckoutAction(payloadFor(started, card.id));

    // Assert
    expect(result).toEqual({ error: 'deferred-cap-exceeded' });
    expect(await readHoldStatus(db, started.holdId)).toBe('released');
    const { count } = await db
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('hold_id', started.holdId);
    expect(count).toBe(0);
  });
});

describe('paso 2 — idempotencia con el tope lleno', () => {
  it('returns the same booking when step 2 is repeated and that booking filled the cap', async () => {
    // Arrange: el resto del tope de la tarjeta ya está lleno; esta reserva lo completa.
    const started = await startCheckout();
    const card = cardOf(started.customerId);
    for (let i = 0; i < BOOKINGS_TO_FILL_CAP - 1; i += 1) {
      await createDeferredBooking(db, instanceId, {
        p_customer_email: newEmail(),
        p_card_brand: card.brand,
        p_card_last4: card.last4 as string,
      });
    }
    const first = await completeDeferredCheckoutAction(payloadFor(started, card.id));
    if (!('bookingId' in first)) throw new Error(`first: ${first.error}`);

    // Act: la respuesta se perdió y el navegador repite el paso 2.
    const again = await completeDeferredCheckoutAction(payloadFor(started, card.id));

    // Assert
    expect(again).toEqual({ bookingId: first.bookingId });
    expect(await readHoldStatus(db, started.holdId)).toBe('paying');
  });
});

describe('paso 1 — techo diario por IP', () => {
  async function dailyCount(ip: string): Promise<number> {
    const { data } = await db
      .from('rate_limits')
      .select('count')
      .eq('key', rateLimitKey(RATE_LIMIT_KEY_PREFIX.deferredStartIpDay, ip))
      .maybeSingle();
    return data?.count ?? 0;
  }

  it('does not spend the daily budget on attempts the 10-minute limit already stopped', async () => {
    // Arrange: agotar el límite de 10 minutos de esta IP.
    state.rateLimit = 'true';
    const shortLimit = RATE_LIMITS.checkoutPerIp.limit;
    for (let i = 0; i < shortLimit; i += 1) {
      await startDeferredCheckoutAction(null, checkoutForm(newEmail()));
    }
    const before = await dailyCount(state.ip);

    // Act: intentos frenados por el de 10 minutos.
    const blocked = await startDeferredCheckoutAction(null, checkoutForm(newEmail()));
    await startDeferredCheckoutAction(null, checkoutForm(newEmail()));

    // Assert
    expect(blocked).toEqual({ error: 'error-generic' });
    expect(before).toBe(shortLimit);
    expect(await dailyCount(state.ip)).toBe(before);
  });
});

describe('paso 2 — límite por IP', () => {
  it('stops calling OnvoPay once the IP goes over the limit', async () => {
    // Arrange: el paso 1 fuera del límite; después, el límite del paso 2 encendido. Una tarjeta
    // desvinculada hace que cada intento llegue al GET y falle sin crear la reserva.
    const started = await startCheckout();
    const card = cardOf(started.customerId, { status: 'detached' });
    state.rateLimit = 'true';
    const limit = RATE_LIMITS.deferredCompletePerIp.limit;
    for (let i = 0; i < limit; i += 1) {
      await completeDeferredCheckoutAction(payloadFor(started, card.id));
    }
    provider.getPaymentMethod.mockClear();

    // Act
    const result = await completeDeferredCheckoutAction(payloadFor(started, card.id));

    // Assert
    expect(result).toEqual({ error: 'error-generic' });
    expect(provider.getPaymentMethod).not.toHaveBeenCalled();
  });
});
