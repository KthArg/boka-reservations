// Job resolve-minimum (specs 0035 y 0045) contra la base real: en la ventana de 24 h 10 min a
// 25 h cancela las salidas vacías, deja las que tienen reservas en manos del staff o las cancela
// según la política, alerta las atrasadas y correrlo dos veces da lo mismo.
// Requiere: supabase start + seed.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/env.js', async () => (await import('./charge-mocks.js')).fakeEnvModule());
vi.mock('@sentry/node', async () => (await import('./charge-mocks.js')).fakeSentryModule());

const { sentry } = await import('./charge-mocks.js');
const { runResolveMinimum, resetOverdueAlertsForTest } =
  await import('../../src/jobs/resolve-minimum.js');
const { db, deleteDepartures, HOUR_MS, isoFromNow, MINUTE_MS, must, ok } =
  await import('./deferred-fixtures.js');

const tourIds: string[] = [];

async function departure(startsInMs: number, minimum: number, paidSeats: number) {
  const tour = must(
    await db
      .from('tours')
      .insert({
        slug: `resolve-minimum-${crypto.randomUUID().slice(0, 8)}`,
        name_es: 'T',
        name_en: 'T',
        description_es: 'd',
        description_en: 'd',
        difficulty: 'easy',
        duration_minutes: 60,
        meeting_point_es: 'P',
        meeting_point_en: 'P',
        includes_es: 'g',
        includes_en: 'g',
        min_participants: minimum,
        max_capacity: 10,
      })
      .select('id')
      .single(),
    'tour',
  );
  tourIds.push(tour.id);
  const schedule = must(
    await db
      .from('tour_schedules')
      .insert({ tour_id: tour.id, day_of_week: 2, start_time: '08:00', capacity: 10 })
      .select('id')
      .single(),
    'schedule',
  );
  const startsAt = isoFromNow(startsInMs);
  const instance = must(
    await db
      .from('tour_instances')
      .insert({
        tour_id: tour.id,
        schedule_id: schedule.id,
        starts_at: startsAt,
        ends_at: startsAt,
        capacity_total: 10,
        capacity_reserved: paidSeats,
      })
      .select('id')
      .single(),
    'instance',
  );
  if (paidSeats > 0) {
    const booking = must(
      await db
        .from('bookings')
        .insert({
          tour_instance_id: instance.id,
          customer_name: 'Turista',
          customer_email: 'turista@example.com',
          tickets_adult: paidSeats,
          total_amount_cents: 9000,
          currency: 'USD',
          status: 'confirmed',
          locale: 'es',
        })
        .select('id')
        .single(),
      'booking',
    );
    ok(
      await db.from('payments').insert({
        booking_id: booking.id,
        external_provider: 'onvopay',
        external_payment_id: `pi_${crypto.randomUUID()}`,
        amount_cents: 9000,
        status: 'succeeded',
      }),
      'payment',
    );
  }
  return instance.id;
}

async function instance(id: string) {
  return must(
    await db
      .from('tour_instances')
      .select('status, cancellation_reason, minimum_resolution')
      .eq('id', id)
      .single(),
    'instance',
  );
}

async function setPolicy(policy: 'staff_decides' | 'auto_cancel'): Promise<void> {
  ok(
    await db.from('business_settings').update({ below_minimum_policy: policy }).eq('id', 1),
    'setPolicy',
  );
}

async function resolveNow(id: string): Promise<string> {
  return must(await db.rpc('resolve_immediate_minimum', { p_instance_id: id }), 'resolve');
}

const IN_WINDOW_MS = 24 * HOUR_MS + 30 * MINUTE_MS;

beforeEach(async () => {
  sentry.alerts.length = 0;
  resetOverdueAlertsForTest();
  await setPolicy('staff_decides');
});

afterAll(async () => {
  await setPolicy('staff_decides');
  await deleteDepartures(tourIds);
});

describe('runResolveMinimum', () => {
  it('cancela la salida bajo el mínimo de la ventana y resuelve la que lo alcanzó', async () => {
    // Arrange
    await setPolicy('auto_cancel');
    const below = await departure(24 * HOUR_MS + 30 * MINUTE_MS, 4, 2);
    const reached = await departure(24 * HOUR_MS + 40 * MINUTE_MS, 2, 2);

    // Act
    await runResolveMinimum(db, new Date());

    // Assert
    expect(await instance(below)).toEqual({
      status: 'cancelled',
      cancellation_reason: 'minimum',
      minimum_resolution: 'auto_cancelled',
    });
    expect((await instance(reached)).minimum_resolution).toBe('reached');
  });

  it('no toca las salidas fuera de la ventana', async () => {
    const early = await departure(24 * HOUR_MS + 5 * MINUTE_MS, 4, 0);
    const late = await departure(26 * HOUR_MS, 4, 0);

    await runResolveMinimum(db, new Date());

    expect((await instance(early)).minimum_resolution).toBeNull();
    expect((await instance(late)).minimum_resolution).toBeNull();
  });

  it('correrlo dos veces da lo mismo', async () => {
    await setPolicy('auto_cancel');
    const below = await departure(24 * HOUR_MS + 30 * MINUTE_MS, 4, 2);

    await runResolveMinimum(db, new Date());
    await runResolveMinimum(db, new Date());

    expect((await instance(below)).status).toBe('cancelled');
    const { data: bookings } = await db.from('bookings').select('id').eq('tour_instance_id', below);
    const { count } = await db
      .from('refunds')
      .select('id', { count: 'exact', head: true })
      .in(
        'booking_id',
        (bookings ?? []).map((b) => b.id),
      );
    expect(count).toBe(1);
  });

  it('alerta una sola vez la salida atrasada bajo el mínimo y no la cancela', async () => {
    const overdue = await departure(12 * HOUR_MS, 4, 1);

    await runResolveMinimum(db, new Date());
    await runResolveMinimum(db, new Date());

    expect((await instance(overdue)).status).not.toBe('cancelled');
    const alerts = sentry.alerts.filter((a) => a.fingerprint === 'resolve-minimum-overdue');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    // Con cupos cobrados y `staff_decides` es una decisión que nadie tomó, no un worker caído.
    expect(alerts.some((a) => a.level === 'warning')).toBe(true);
    // Una por salida: la nuestra no se repite en la segunda corrida.
    const again = alerts.length;
    await runResolveMinimum(db, new Date());
    expect(sentry.alerts.filter((a) => a.fingerprint === 'resolve-minimum-overdue')).toHaveLength(
      again,
    );
  });
});

describe('política de las salidas bajo el mínimo (spec 0045)', () => {
  it('deja en manos del staff la salida con reservas y no toca nada', async () => {
    // Arrange
    const below = await departure(IN_WINDOW_MS, 4, 2);

    // Act
    const outcome = await resolveNow(below);
    await runResolveMinimum(db, new Date());

    // Assert
    expect(outcome).toBe('awaiting_staff');
    expect(await instance(below)).toEqual({
      status: 'available',
      cancellation_reason: null,
      minimum_resolution: null,
    });
    const { data: bookings } = await db
      .from('bookings')
      .select('status')
      .eq('tour_instance_id', below);
    expect(bookings).toEqual([{ status: 'confirmed' }]);
  });

  it.each(['staff_decides', 'auto_cancel'] as const)(
    'cancela sola la salida sin reservas con la política %s',
    async (policy) => {
      await setPolicy(policy);
      const empty = await departure(IN_WINDOW_MS, 4, 0);

      await runResolveMinimum(db, new Date());

      expect(await instance(empty)).toEqual({
        status: 'cancelled',
        cancellation_reason: 'minimum',
        minimum_resolution: 'auto_cancelled',
      });
    },
  );

  // Alguien está pagando: cancelar ahora le cobraría y reembolsaría. Se vuelve a mirar en 5 min.
  it('no cancela la salida sin reservas mientras tiene un apartado vivo', async () => {
    const empty = await departure(IN_WINDOW_MS, 4, 0);
    ok(
      await db.from('tour_holds').insert({
        tour_instance_id: empty,
        session_token: crypto.randomUUID(),
        held_seats: 1,
        status: 'active',
        expires_at: isoFromNow(10 * MINUTE_MS),
      }),
      'hold',
    );

    expect(await resolveNow(empty)).toBe('checkout_in_progress');
    expect((await instance(empty)).status).toBe('available');

    // El apartado vence sin pago: la corrida siguiente la cancela.
    ok(
      await db.from('tour_holds').update({ status: 'expired' }).eq('tour_instance_id', empty),
      'expire hold',
    );
    expect(await resolveNow(empty)).toBe('cancelled');
  });

  it('no cancela la salida vacía de un tour sin mínimo', async () => {
    const noMinimum = await departure(IN_WINDOW_MS, 1, 0);

    await runResolveMinimum(db, new Date());

    expect((await instance(noMinimum)).status).toBe('available');
    expect((await instance(noMinimum)).minimum_resolution).toBe('reached');
  });

  // Todas sus reservas diferidas se cancelaron después de abrir el ciclo: es una vacía más.
  it('cancela la salida vacía que quedó con un ciclo de cobro abierto', async () => {
    const empty = await departure(IN_WINDOW_MS, 4, 0);
    ok(
      await db
        .from('tour_instances')
        .update({
          minimum_charge_triggered_at: new Date().toISOString(),
          min_participants_at_trigger: 4,
          seats_at_trigger: 1,
          staff_decision_required_at: isoFromNow(-HOUR_MS),
        })
        .eq('id', empty),
      'open cycle',
    );

    await runResolveMinimum(db, new Date());

    expect((await instance(empty)).status).toBe('cancelled');
  });

  it('alerta como error la salida vacía que pasó la ventana sin cancelarse', async () => {
    await departure(12 * HOUR_MS, 4, 0);

    await runResolveMinimum(db, new Date());

    const alerts = sentry.alerts.filter((a) => a.fingerprint === 'resolve-minimum-overdue');
    expect(alerts.some((a) => a.level === 'error')).toBe(true);
  });
});
