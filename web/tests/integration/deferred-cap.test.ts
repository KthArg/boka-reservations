// Tope de cupos vivos por persona del checkout diferido (spec 0048 §5.1; migración …063): por
// email normalizado y por tarjeta (últimos 4 + marca), sumando las salidas futuras,
// en la creación y en el cambio de tarjeta. Más la consulta de la alerta de acaparamiento (§5.3).
// Llama las funciones SQL directo con service_role.
// Excede 150 líneas: excepción de testing-practices (lógica de dinero e inventario).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import { DEFERRED_MAX_LIVE_SEATS_PER_IDENTITY } from '@shared/constants/bookings';
import { deleteToursDeep } from './cleanup';
import {
  createActiveHold,
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  deferredArgs,
  HOLD_SEATS,
  must,
  ok,
  readBooking,
  readHoldStatus,
  startCharge,
  uid,
  randomCardExpiry,
  type Db,
  type DeferredArgs,
  randomLast4,
  uniqueCardBrand,
} from './deferred-fixtures';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Reservas de HOLD_SEATS que llenan el tope justo. */
const BOOKINGS_TO_FILL_CAP = DEFERRED_MAX_LIVE_SEATS_PER_IDENTITY / HOLD_SEATS;
const CAP_ERROR = 'DEFERRED_CAP_EXCEEDED';

const tourIds: string[] = [];
let instanceId: string;

type Card = {
  p_card_brand: string | null;
  p_card_last4: string;
  p_card_exp_month: number;
  p_card_exp_year: number;
};

/**
 * Tarjeta propia de cada caso (marca única): no se suma con las de otros casos. Con `null`, una
 * tarjeta sin marca; la unicidad la dan los últimos 4 y solo la usa el caso de la marca NULL.
 */
function newCard(brand: string | null = uniqueCardBrand()): Card {
  const { month, year } = randomCardExpiry();
  return {
    p_card_brand: brand,
    p_card_last4: randomLast4(),
    p_card_exp_month: month,
    p_card_exp_year: year,
  };
}

const newEmail = () => `tope-${uid()}@example.com`;

async function ownDeparture(): Promise<string> {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  return departure.instanceId;
}

/** n reservas vivas; sin email o tarjeta en `base`, cada una lleva los suyos. */
async function fill(
  n: number,
  base: Partial<DeferredArgs>,
  target = instanceId,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const overrides = { p_customer_email: newEmail(), ...newCard(), ...base };
    ids.push((await createDeferredBooking(db, target, overrides)).bookingId);
  }
  return ids;
}

/** Intenta una reserva más; devuelve el resultado de la RPC y el hold usado. */
async function attempt(overrides: Partial<DeferredArgs>, target = instanceId) {
  const hold = await createActiveHold(db, target);
  const result = await db.rpc('create_deferred_booking', deferredArgs(hold, overrides));
  return { error: result.error, hold };
}

beforeAll(async () => {
  instanceId = await ownDeparture();
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

describe('create_deferred_booking — tope por email', () => {
  it('accepts up to the cap and rejects the booking that goes over it', async () => {
    // Arrange
    const email = newEmail();
    await fill(BOOKINGS_TO_FILL_CAP, { p_customer_email: email });

    // Act
    const over = await attempt({ p_customer_email: email, ...newCard() });

    // Assert: la RPC aborta entera, así que el hold sigue activo (el caller lo libera).
    expect(over.error?.message).toContain(CAP_ERROR);
    expect(await readHoldStatus(db, over.hold.holdId)).toBe('active');
  });

  it('counts the same email with other case and spaces as the same person', async () => {
    // Arrange
    const email = newEmail();
    await fill(BOOKINGS_TO_FILL_CAP, { p_customer_email: email });

    // Act
    const over = await attempt({ p_customer_email: `  ${email.toUpperCase()} `, ...newCard() });

    // Assert
    expect(over.error?.message).toContain(CAP_ERROR);
  });

  it('adds up bookings from different departures', async () => {
    // Arrange
    const email = newEmail();
    const other = await ownDeparture();
    await fill(BOOKINGS_TO_FILL_CAP - 1, { p_customer_email: email });
    await fill(1, { p_customer_email: email }, other);

    // Act
    const over = await attempt({ p_customer_email: email, ...newCard() });

    // Assert
    expect(over.error?.message).toContain(CAP_ERROR);
  });
});

describe('create_deferred_booking — tope por tarjeta', () => {
  it('rejects the same card with different emails once it reaches the cap', async () => {
    // Arrange
    const card = newCard();
    await fill(BOOKINGS_TO_FILL_CAP, card);

    // Act
    const over = await attempt({ p_customer_email: newEmail(), ...card });

    // Assert
    expect(over.error?.message).toContain(CAP_ERROR);
  });

  it('applies to a card without brand too (a NULL brand still locks and matches)', async () => {
    // Arrange
    const card = newCard(null);
    await fill(BOOKINGS_TO_FILL_CAP, card);

    // Act
    const over = await attempt({ p_customer_email: newEmail(), ...card });

    // Assert
    expect(over.error?.message).toContain(CAP_ERROR);
  });

  it('does not mix cards that only share the last 4 digits', async () => {
    // Arrange
    const card = newCard();
    await fill(BOOKINGS_TO_FILL_CAP, card);

    // Act
    const result = await attempt({
      p_customer_email: newEmail(),
      ...card,
      p_card_brand: uniqueCardBrand('mastercard'),
    });

    // Assert
    expect(result.error).toBeNull();
  });
});

describe('create_deferred_booking — qué reservas cuentan', () => {
  it.each(['cancelled', 'confirmed'] as const)('stops counting a %s booking', async (status) => {
    // Arrange
    const email = newEmail();
    const [first] = await fill(BOOKINGS_TO_FILL_CAP, { p_customer_email: email });
    ok(await db.from('bookings').update({ status }).eq('id', first!), status);

    // Act
    const result = await attempt({ p_customer_email: email, ...newCard() });

    // Assert
    expect(result.error).toBeNull();
  });

  it('keeps counting a booking whose charge is in progress (pending_payment)', async () => {
    // Arrange
    const email = newEmail();
    const [first] = await fill(BOOKINGS_TO_FILL_CAP, { p_customer_email: email });
    await startCharge(db, first!);
    expect((await readBooking(db, first!)).status).toBe('pending_payment');

    // Act
    const over = await attempt({ p_customer_email: email, ...newCard() });

    // Assert
    expect(over.error?.message).toContain(CAP_ERROR);
  });

  it('does not count bookings of a departure already gone or cancelled', async () => {
    // Arrange
    const email = newEmail();
    const gone = await ownDeparture();
    const cancelled = await ownDeparture();
    await fill(2, { p_customer_email: email }, gone);
    await fill(2, { p_customer_email: email }, cancelled);
    ok(
      await db
        .from('tour_instances')
        .update({ starts_at: new Date(Date.now() - DAY_MS).toISOString() })
        .eq('id', gone),
      'move to the past',
    );
    ok(
      await db.from('tour_instances').update({ status: 'cancelled' }).eq('id', cancelled),
      'cancel departure',
    );
    // Con las otras dos salidas ya fuera, se completa el tope menos una en la vigente.
    await fill(BOOKINGS_TO_FILL_CAP - 1, { p_customer_email: email });

    // Act: solo cuentan las BOOKINGS_TO_FILL_CAP - 1 de la salida vigente.
    const result = await attempt({ p_customer_email: email, ...newCard() });

    // Assert
    expect(result.error).toBeNull();
  });

  it('lets exactly one of two concurrent bookings through when both would pass the cap', async () => {
    // Arrange: lugar para una reserva más, y dos pasos 2 a la vez.
    const email = newEmail();
    await fill(BOOKINGS_TO_FILL_CAP - 1, { p_customer_email: email });

    // Act
    const results = await Promise.all([
      attempt({ p_customer_email: email, ...newCard() }),
      attempt({ p_customer_email: email, ...newCard() }),
    ]);

    // Assert
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(results.filter((r) => r.error?.message.includes(CAP_ERROR))).toHaveLength(1);
  });

  it('serializes two people sharing one card without deadlocking', async () => {
    // Arrange
    const card = newCard();
    await fill(BOOKINGS_TO_FILL_CAP - 1, card);

    // Act
    const results = await Promise.all([
      attempt({ p_customer_email: newEmail(), ...card }),
      attempt({ p_customer_email: newEmail(), ...card }),
    ]);

    // Assert
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(results.filter((r) => r.error?.message.includes(CAP_ERROR))).toHaveLength(1);
  });
});

describe('update_booking_payment_method — tope por tarjeta', () => {
  function changeTo(bookingId: string, customerId: string, card: Card) {
    return db.rpc('update_booking_payment_method', {
      p_booking_id: bookingId,
      p_customer_external_id: customerId,
      p_payment_method_id: `pm_${uid()}`,
      ...card,
      p_consent_version: 'test-v1',
    });
  }

  it('rejects moving a booking to a card already at the cap, keeping the old card', async () => {
    // Arrange
    const full = newCard();
    await fill(BOOKINGS_TO_FILL_CAP, full);
    const { bookingId, hold } = await createDeferredBooking(db, instanceId, newCard());
    const before = await readBooking(db, bookingId);

    // Act
    const outcome = must(await changeTo(bookingId, hold.customerId, full), 'change');

    // Assert
    expect(outcome).toBe('cap_exceeded');
    const after = await readBooking(db, bookingId);
    expect(after.payment_method_id).toBe(before.payment_method_id);
    expect(after.card_exp_year).toBe(before.card_exp_year);
  });

  it('does not count the booking itself when it saves the same card again', async () => {
    // Arrange: con esta reserva, la tarjeta queda justo en el tope.
    const card = newCard();
    await fill(BOOKINGS_TO_FILL_CAP - 1, card);
    const { bookingId, hold } = await createDeferredBooking(db, instanceId, card);

    // Act
    const outcome = must(await changeTo(bookingId, hold.customerId, card), 'change');

    // Assert
    expect(outcome).toBe('updated');
  });
});

describe('deferred_live_seats_for_email', () => {
  it('returns the live seats of the email, and zero for an empty email', async () => {
    // Arrange
    const email = newEmail();
    await fill(2, { p_customer_email: email });

    // Act
    const seats = must(await db.rpc('deferred_live_seats_for_email', { p_email: email }), 'seats');
    const empty = must(await db.rpc('deferred_live_seats_for_email', { p_email: '  ' }), 'empty');

    // Assert
    expect(seats).toBe(2 * HOLD_SEATS);
    expect(empty).toBe(0);
  });
});

describe('deferred_hoarding_candidates', () => {
  const SMALL_CAPACITY = 8;

  async function smallDeparture(): Promise<string> {
    const id = await ownDeparture();
    ok(
      await db.from('tour_instances').update({ capacity_total: SMALL_CAPACITY }).eq('id', id),
      'capacity',
    );
    return id;
  }

  async function candidateIds(): Promise<string[]> {
    const rows = must(
      await db.rpc('deferred_hoarding_candidates', { p_share: 0.5, p_max_identities: 2 }),
      'candidates',
    );
    return rows.map((r) => r.instance_id);
  }

  it('flags a departure with half its seats held by one email', async () => {
    // Arrange: 4 de 8 cupos, un solo email.
    const target = await smallDeparture();
    await fill(2, { p_customer_email: newEmail() }, target);

    // Act + Assert
    expect(await candidateIds()).toContain(target);
  });

  it('flags one card spread over many emails', async () => {
    // Arrange
    const target = await smallDeparture();
    await fill(3, newCard(), target);

    // Act + Assert
    expect(await candidateIds()).toContain(target);
  });

  it('flags exactly two identities and ignores three', async () => {
    // Arrange: 6 de 8 cupos (75 %) en 2 emails, y en 3 emails.
    const two = await smallDeparture();
    const twoEmails = [newEmail(), newEmail()];
    for (const email of [...twoEmails, twoEmails[0]!]) {
      await fill(1, { p_customer_email: email }, two);
    }
    const three = await smallDeparture();
    await fill(3, {}, three);

    // Act
    const ids = await candidateIds();

    // Assert
    expect(ids).toContain(two);
    expect(ids).not.toContain(three);
  });

  it('ignores a departure just under half its capacity', async () => {
    // Arrange: 2 de 6 cupos (33 %), todos de un mismo email.
    const target = await ownDeparture();
    ok(await db.from('tour_instances').update({ capacity_total: 6 }).eq('id', target), 'cap');
    await fill(1, { p_customer_email: newEmail() }, target);

    // Act + Assert
    expect(await candidateIds()).not.toContain(target);
  });

  it('ignores a cancelled departure', async () => {
    // Arrange
    const target = await smallDeparture();
    await fill(2, { p_customer_email: newEmail() }, target);
    ok(await db.from('tour_instances').update({ status: 'cancelled' }).eq('id', target), 'cancel');

    // Act + Assert
    expect(await candidateIds()).not.toContain(target);
  });
});
