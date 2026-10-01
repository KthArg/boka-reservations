// Motor del cobro del mínimo (spec 0033) — integración contra DB real con OnvoPay y Sentry
// simulados (charge-mocks.ts). Lo que estas pruebas protegen es la promesa del spec: una salida
// que no llega al mínimo no le cuesta un centavo a nadie, porque nunca se captura.
// Excede 150 líneas: excepción de testing-practices (lógica de dinero con muchos casos).
// Requiere: supabase start + seed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/env.js', async () => (await import('./charge-mocks.js')).fakeEnvModule());
vi.mock('@sentry/node', async () => (await import('./charge-mocks.js')).fakeSentryModule());
vi.mock('../../src/charges/onvopay.js', async () => ({
  createOnvopayChargeClient: (await import('./charge-mocks.js')).fakeChargeClient,
}));

const { alertFor, envState, onvo, resetChargeMocks } = await import('./charge-mocks.js');
const { chargeDepartures } = await import('../../src/jobs/charge-departures.js');
const {
  createDeferredBooking,
  createDeparture,
  db,
  DAY_MS,
  deleteDepartures,
  deleteWebhookEvents,
  HOUR_MS,
  isoFromNow,
  MANDATE_CENTS,
  MANDATE_CURRENCY,
  must,
  ok,
  readBooking,
  recordDecline,
  startCharge,
  updateBooking,
} = await import('./deferred-fixtures.js');

type Timing = 'on_minimum' | 'before_departure';

let departure: { tourId: string; instanceId: string };

/** El tour del fixture arranca con mínimo 4; estas suites trabajan con 2 para ir al grano. */
async function configureTour(changes: {
  minimum?: number;
  timing?: Timing;
  leadHours?: number | null;
  autoCancel?: boolean;
}): Promise<void> {
  ok(
    await db
      .from('tours')
      .update({
        min_participants: changes.minimum ?? 2,
        charge_timing: changes.timing ?? 'on_minimum',
        charge_lead_hours: changes.leadHours ?? null,
        auto_cancel_below_minimum: changes.autoCancel ?? true,
      })
      .eq('id', departure.tourId),
    'configureTour',
  );
}

async function moveDeparture(inMs: number): Promise<void> {
  const startsAt = isoFromNow(inMs);
  ok(
    await db
      .from('tour_instances')
      .update({ starts_at: startsAt, ends_at: startsAt })
      .eq('id', departure.instanceId),
    'moveDeparture',
  );
}

async function readDeparture() {
  return must(
    await db.from('tour_instances').select('*').eq('id', departure.instanceId).single(),
    'readDeparture',
  );
}

/** Adelanta el plazo del ciclo: el motor decide con el reloj de la DB, no con uno simulado. */
async function expireDeadline(): Promise<void> {
  ok(
    await db
      .from('tour_instances')
      .update({ staff_decision_required_at: isoFromNow(-60 * 1000) })
      .eq('id', departure.instanceId),
    'expireDeadline',
  );
}

async function seats(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(await seat());
  }
  return ids;
}

async function seat(): Promise<string> {
  const { bookingId } = await createDeferredBooking(departure.instanceId);
  return bookingId;
}

/** Tarjeta que el confirm rechaza: la reserva vuelve a pending_minimum con su backoff. */
async function withDecliningCard(bookingId: string): Promise<void> {
  const booking = await readBooking(bookingId);
  onvo.declineOnConfirm.set(booking.payment_method_id as string, 'failed');
}

/** Intents que la suite crea por fuera del motor (cobros ya confirmados). */
const extraEvents: string[] = [];

const statusesOf = async (ids: string[]) =>
  Promise.all(ids.map(async (id) => (await readBooking(id)).status));

beforeEach(async () => {
  resetChargeMocks();
  envState.deferredChargeEnabled = true;
  departure = await createDeparture(10 * DAY_MS);
  await configureTour({});
});

afterEach(async () => {
  await deleteDepartures([departure.tourId]);
  await deleteWebhookEvents([...onvo.created, ...extraEvents.splice(0)]);
});

describe('charge-departures — el ciclo completo', () => {
  it('authorizes and captures every booking once the minimum is met', async () => {
    // Arrange
    const bookings = await seats(2);

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.created).toHaveLength(2);
    expect(onvo.captured).toHaveLength(2);
    expect(await statusesOf(bookings)).toEqual(['confirmed', 'confirmed']);
    const instance = await readDeparture();
    expect(instance.minimum_resolution).toBe('reached');
    expect(instance.capacity_reserved).toBe(2);
  });

  // La promesa del spec: la salida que no llega al mínimo se suelta, y soltar una autorización no
  // deja transacción de balance (verificado en el sandbox de OnvoPay, 2026-09-23).
  it('releases every authorization and cancels without charging a cent below the minimum', async () => {
    // Arrange
    await configureTour({ minimum: 3 });
    await moveDeparture(2 * DAY_MS);
    const bookings = await seats(2);
    await chargeDepartures();
    await expireDeadline();

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.captured).toEqual([]);
    expect(onvo.cancelled).toEqual(onvo.created);
    expect(await statusesOf(bookings)).toEqual(['cancelled', 'cancelled']);
    const instance = await readDeparture();
    expect(instance.minimum_resolution).toBe('auto_cancelled');
    expect(instance.status).toBe('cancelled');
    const { data: payments } = await db
      .from('payments')
      .select('status')
      .in('booking_id', bookings);
    expect(payments?.every((p) => p.status === 'failed')).toBe(true);
  });

  it('emails each tourist once about the cancelled departure', async () => {
    // Arrange
    await configureTour({ minimum: 3 });
    await moveDeparture(2 * DAY_MS);
    const bookings = await seats(2);
    await chargeDepartures();
    await expireDeadline();

    // Act
    await chargeDepartures();

    // Assert
    const { data: notifications } = await db
      .from('notifications')
      .select('booking_id')
      .eq('kind', 'departure_cancelled_minimum')
      .in('booking_id', bookings);
    expect(notifications?.map((n) => n.booking_id).sort()).toEqual([...bookings].sort());
  });

  // Cancelar una salida lejana por una foto de hoy sería cancelar de más: se cierra el ciclo y se
  // vuelve a evaluar cerca de la fecha, sin plata retenida mientras tanto.
  it('closes the cycle instead of cancelling a departure that is still far away', async () => {
    // Arrange
    const bookings = await seats(2);
    await withDecliningCard(bookings[1] as string);
    await chargeDepartures();
    await expireDeadline();

    // Act
    await chargeDepartures();

    // Assert
    const instance = await readDeparture();
    expect(instance.minimum_charge_closed_at).not.toBeNull();
    expect(instance.minimum_resolved_at).toBeNull();
    expect(instance.status).not.toBe('cancelled');
    expect(await statusesOf(bookings)).toEqual(['pending_minimum', 'pending_minimum']);
  });

  it('waits without moving money while the deadline has not passed', async () => {
    // Arrange
    await configureTour({ minimum: 3 });
    await moveDeparture(2 * DAY_MS);
    const bookings = await seats(2);

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.captured).toEqual([]);
    expect(onvo.cancelled).toEqual([]);
    expect(await statusesOf(bookings)).toEqual(['pending_payment', 'pending_payment']);
    expect((await readDeparture()).minimum_charge_triggered_at).not.toBeNull();
  });

  // El caso que originó el spec: con el cobro directo, las tarjetas que sí entraban quedaban
  // cobradas en una salida que igual se cancelaba.
  it('never captures the cards that worked when another one is declined below the minimum', async () => {
    // Arrange
    await moveDeparture(2 * DAY_MS);
    const first = await seat();
    const second = await seat();
    await withDecliningCard(second);

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.captured).toEqual([]);
    expect((await readBooking(first)).status).toBe('pending_payment');
    expect((await readBooking(second)).status).toBe('pending_minimum');
    expect((await readBooking(second)).charge_attempts).toBe(1);
  });

  it('leaves a departure to a person when the tour does not auto-cancel', async () => {
    // Arrange
    await configureTour({ minimum: 3, autoCancel: false });
    await moveDeparture(2 * DAY_MS);
    await seats(2);
    await chargeDepartures();
    await expireDeadline();

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.cancelled).toEqual(onvo.created);
    const instance = await readDeparture();
    expect(instance.minimum_resolved_at).toBeNull();
    expect(instance.status).not.toBe('cancelled');
  });
});

describe('charge-departures — cuándo corresponde cobrar', () => {
  it('does not touch a before_departure tour until its lead time', async () => {
    // Arrange
    await configureTour({ timing: 'before_departure', leadHours: 24 });
    await moveDeparture(3 * DAY_MS);
    const bookings = await seats(2);

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.created).toEqual([]);
    expect(await statusesOf(bookings)).toEqual(['pending_minimum', 'pending_minimum']);
    expect((await readDeparture()).minimum_charge_triggered_at).toBeNull();
  });

  it('charges a before_departure tour once its lead time arrived', async () => {
    // Arrange
    await configureTour({ timing: 'before_departure', leadHours: 24 });
    await moveDeparture(20 * HOUR_MS);
    const bookings = await seats(2);

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.captured).toHaveLength(2);
    expect(await statusesOf(bookings)).toEqual(['confirmed', 'confirmed']);
  });

  it('waits for the minimum on an on_minimum tour instead of charging the first booking', async () => {
    // Arrange
    await configureTour({ minimum: 3 });
    const bookings = await seats(2);

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.created).toEqual([]);
    expect(await statusesOf(bookings)).toEqual(['pending_minimum', 'pending_minimum']);
  });

  // Una reserva que entra con la salida ya resuelta se cobra sola, sin volver a decidir el mínimo.
  it('charges a late booking on an already resolved departure', async () => {
    // Arrange
    await seats(2);
    await chargeDepartures();
    const late = await seat();

    // Act
    await chargeDepartures();

    // Assert
    expect((await readBooking(late)).status).toBe('confirmed');
    expect((await readDeparture()).minimum_resolution).toBe('reached');
  });
});

describe('charge-departures — interruptores', () => {
  it('does nothing while the engine flag is off', async () => {
    // Arrange
    envState.deferredChargeEnabled = false;
    const bookings = await seats(2);

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.created).toEqual([]);
    expect(await statusesOf(bookings)).toEqual(['pending_minimum', 'pending_minimum']);
    // Web vendiendo en diferido con el motor apagado: nadie cobraría esas reservas.
    expect(alertFor('charge-engine-off-with-bookings')?.level).toBe('error');
  });

  it('does nothing without the OnvoPay key', async () => {
    // Arrange
    envState.secretKey = undefined;
    await seats(2);

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.created).toEqual([]);
  });

  // Marcha atrás del spec (§11): soltar lo vivo y cerrar, sin cobrar nada.
  it('releases live authorizations and closes the cycle in release-only mode', async () => {
    // Arrange
    await configureTour({ minimum: 3 });
    await moveDeparture(2 * DAY_MS);
    const bookings = await seats(2);
    await chargeDepartures();
    envState.releaseAuthorizationsOnly = true;

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.cancelled).toEqual(onvo.created);
    expect(onvo.captured).toEqual([]);
    expect(await statusesOf(bookings)).toEqual(['pending_minimum', 'pending_minimum']);
    const instance = await readDeparture();
    expect(instance.minimum_charge_closed_at).not.toBeNull();
    expect(instance.minimum_resolved_at).toBeNull();
  });
});

describe('charge-departures — los caminos donde se pierde plata', () => {
  /** Reserva con el cobro empezado y la autorización viva que nadie registró (§5.3). */
  async function orphan(): Promise<{ bookingId: string; intent: string }> {
    await configureTour({ minimum: 1, timing: 'before_departure', leadHours: 720 });
    const bookingId = await seat();
    const intent = await startCharge(bookingId);
    onvo.intents.set(intent, { status: 'requires_capture' });
    return { bookingId, intent };
  }

  // Crear un intent nuevo sobre una retención viva le retendría al turista el doble.
  it('adopts a live authorization instead of creating a second one', async () => {
    // Arrange
    const { bookingId, intent } = await orphan();

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.created).toEqual([]);
    const booking = await readBooking(bookingId);
    expect(booking.authorized_at).not.toBeNull();
    expect(booking.status).toBe('pending_payment');
    expect(onvo.captured).toEqual([intent]);
  });

  // Sin cerrar la fila del intent muerto, charge_booking_start responde intent_mismatch para
  // siempre: la reserva no vuelve a intentarse y la salida se cancela teniendo gente.
  it('closes a dead intent so the booking can be charged again', async () => {
    // Arrange
    const { bookingId, intent } = await orphan();
    onvo.intents.set(intent, { status: 'canceled' });

    // Act
    await chargeDepartures();

    // Assert
    const { data: payment } = await db
      .from('payments')
      .select('status, provider_closed_at')
      .eq('external_payment_id', intent)
      .single();
    expect(payment?.status).toBe('failed');
    expect((await readBooking(bookingId)).status).toBe('pending_minimum');
  });

  // Prueba en producción del 2026-10-01: un rechazo deja el intent en requires_payment_method con
  // su pago pending. El reintento creaba un intent nuevo, charge_booking_start respondía
  // intent_mismatch y la reserva no se volvía a cobrar nunca, aunque el turista cambiara la tarjeta.
  it('retries a declined booking on the same intent once the tourist fixes the card', async () => {
    // Arrange
    await configureTour({ minimum: 1, timing: 'before_departure', leadHours: 720 });
    const bookingId = await seat();
    const card = (await readBooking(bookingId)).payment_method_id as string;
    onvo.declineOnConfirm.set(card, 'requires_payment_method');
    await chargeDepartures();
    expect((await readBooking(bookingId)).charge_attempts).toBe(1);
    const [intent] = onvo.created;
    onvo.declineOnConfirm.clear();
    ok(
      await db
        .from('bookings')
        .update({
          charge_started_at: isoFromNow(-2 * HOUR_MS),
          charge_next_attempt_at: isoFromNow(-60 * 1000),
        })
        .eq('id', bookingId),
      'make retry due',
    );

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.created).toEqual([intent]);
    expect(onvo.cancelled).toEqual([]);
    expect(onvo.confirmed).toEqual([intent, intent]);
    expect(onvo.captured).toEqual([intent]);
    expect((await readBooking(bookingId)).status).toBe('confirmed');
  });

  /** Reserva rechazada con el intent de un cobro manual del panel, y el reintento ya vencido. */
  async function declinedOnPanelIntent(): Promise<{ bookingId: string; intent: string }> {
    const bookingId = await seat();
    const intent = await startCharge(bookingId);
    await recordDecline(bookingId, intent);
    await updateBooking(bookingId, {
      charge_started_at: isoFromNow(-2 * HOUR_MS),
      charge_next_attempt_at: isoFromNow(-60 * 1000),
    });
    return { bookingId, intent };
  }

  // El intent del panel es de captura automática: reconfirmarlo cobraría antes de saber si la
  // salida llega al mínimo, que es justo lo que el motor existe para evitar.
  it('replaces an automatic-capture intent instead of charging before the minimum', async () => {
    // Arrange
    await configureTour({ minimum: 3, timing: 'before_departure', leadHours: 720 });
    const { bookingId, intent } = await declinedOnPanelIntent();
    onvo.intents.set(intent, { status: 'requires_payment_method', captureMethod: 'automatic' });

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.cancelled).toEqual([intent]);
    expect(onvo.confirmed).toEqual(onvo.created);
    expect(onvo.captured).toEqual([]);
    const booking = await readBooking(bookingId);
    expect(booking.status).toBe('pending_payment');
    expect(booking.authorized_at).not.toBeNull();
  });

  // Webhook perdido: nadie más mira una pending_minimum hasta que vence su plazo, y mientras
  // tanto no cuenta para el mínimo.
  it('settles a charge that already went through instead of leaving it unclaimed', async () => {
    // Arrange
    await configureTour({ minimum: 3, timing: 'before_departure', leadHours: 720 });
    const { bookingId, intent } = await declinedOnPanelIntent();
    extraEvents.push(intent);
    onvo.intents.set(intent, {
      status: 'succeeded',
      amountCents: MANDATE_CENTS,
      currency: MANDATE_CURRENCY,
    });

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.created).toEqual([]);
    expect((await readBooking(bookingId)).status).toBe('confirmed');
  });

  // El recuento del §5.6: si al descartar la reclamada la salida no alcanza el mínimo, no se
  // captura NADA. Capturar a los demás dejaría plata cobrada en una salida que ya no sale.
  it('captures nothing when a claimed cancellation sinks the minimum', async () => {
    // Arrange
    await configureTour({ minimum: 3, timing: 'before_departure', leadHours: 720 });
    const bookings = await seats(2);
    await chargeDepartures();
    ok(
      await db
        .from('tour_instances')
        .update({ min_participants_at_trigger: 2 })
        .eq('id', departure.instanceId),
      'lower the snapshot',
    );
    ok(
      await db
        .from('bookings')
        .update({ cancel_claimed_at: new Date().toISOString() })
        .eq('id', bookings[0] as string),
      'claim',
    );

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.captured).toEqual([]);
    expect((await readBooking(bookings[1] as string)).status).toBe('pending_payment');
  });

  // Una reserva del cobro inmediato también está `pending_payment` con su intent vivo: soltárselo
  // sería cancelarle el pago al turista que está pagando en ese momento.
  it('never touches a booking of the immediate flow on a mixed departure', async () => {
    // Arrange
    await configureTour({ minimum: 3, timing: 'before_departure', leadHours: 720 });
    const immediate = await seat();
    const intent = await startCharge(immediate);
    onvo.intents.set(intent, { status: 'requires_action' });
    ok(
      await db.from('bookings').update({ payment_method_id: null }).eq('id', immediate),
      'immediate flow',
    );
    await expireDeadline();

    // Act
    await chargeDepartures();

    // Assert
    expect(onvo.cancelled).toEqual([]);
    expect((await readBooking(immediate)).status).toBe('pending_payment');
  });

  // Con plata cobrada la salida no se cancela sola: decide una persona, y mientras tanto las
  // retenciones de los demás se sueltan.
  it('never auto-cancels a departure that already has captured money', async () => {
    // Arrange
    await configureTour({ minimum: 3, timing: 'before_departure', leadHours: 720 });
    const paid = await seat();
    const paidIntent = await startCharge(paid);
    extraEvents.push(paidIntent);
    const confirmed = must(
      await db.rpc('confirm_booking', {
        p_booking_id: paid,
        p_external_payment_id: paidIntent,
        p_event_id: paidIntent,
        p_paid_amount_cents: MANDATE_CENTS,
        p_paid_currency: MANDATE_CURRENCY,
      }),
      'confirm_booking',
    );
    expect(confirmed).toBe('confirmed');
    const pending = await seat();
    await chargeDepartures();
    await moveDeparture(2 * HOUR_MS);
    await expireDeadline();

    // Act
    await chargeDepartures();

    // Assert
    const instance = await readDeparture();
    expect(instance.minimum_resolved_at).toBeNull();
    expect(instance.status).not.toBe('cancelled');
    expect((await readBooking(paid)).status).toBe('confirmed');
    expect((await readBooking(pending)).status).toBe('pending_minimum');
    expect(onvo.cancelled).toEqual(onvo.created);
  });
});
