// Esquema del spec 0029, workstream A (migración …043): constraints e índices únicos del cobro
// diferido, inmutabilidad del mandato, kinds nuevos y coherencia de la resolución del mínimo por
// salida. business_settings tiene su propia suite (business-settings.test.ts).
// Cada rechazo verifica el NOMBRE del constraint, no solo el SQLSTATE: bookings tiene otros
// CHECK (p. ej. bookings_has_tickets) que darían el mismo código por la razón equivocada.
// Excede 150 líneas: excepción de testing-practices (un esquema con muchos casos por tabla).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MinimumResolution } from '@shared/constants/enums';
import { NotificationKind } from '@shared/constants/notifications';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const HOUR_MS = 60 * 60 * 1000;
const DEPARTURE_LEAD_HOURS = 72;
const MANDATE_CENTS = 7000;

type Tables = Database['public']['Tables'];
type BookingInsert = Tables['bookings']['Insert'];
type InstanceUpdate = Tables['tour_instances']['Update'];

const service = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let tourId: string;
let instanceId: string;
let staffId: string;

const uid = () => crypto.randomUUID().slice(0, 8);
const now = () => new Date().toISOString();

// Falla en el setup, cerca de la causa, en vez de con un `!` más adelante.
// Tipado sobre la respuesta entera: es una unión (éxito | error) y la inferencia de `data: T`
// sobre ella colapsa a never.
function must<R extends { data: unknown; error: { message: string } | null }>(
  result: R,
  what: string,
): NonNullable<R['data']> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? 'sin datos'}`);
  }
  return result.data as NonNullable<R['data']>;
}

// Fila válida de reserva (con asiento y monto) sobre la salida de la suite.
function bookingRow(overrides: Partial<BookingInsert> = {}): BookingInsert {
  return {
    tour_instance_id: instanceId,
    customer_name: 'Turista 0029',
    customer_email: `turista-${uid()}@example.com`,
    tickets_adult: 1,
    total_amount_cents: MANDATE_CENTS,
    ...overrides,
  };
}

// Datos mínimos de una reserva diferida válida: tarjeta y customer del checkout.
function deferred(overrides: Partial<BookingInsert> = {}): Partial<BookingInsert> {
  return {
    status: 'pending_minimum',
    payment_method_id: `pm_${uid()}`,
    customer_external_id: `cus_${uid()}`,
    ...overrides,
  };
}

async function insertBooking(overrides: Partial<BookingInsert> = {}): Promise<string> {
  const row = must(
    await service.from('bookings').insert(bookingRow(overrides)).select('id').single(),
    'insertBooking',
  );
  return row.id;
}

beforeAll(async () => {
  const tour = must(
    await service
      .from('tours')
      .insert({
        slug: `minimo-0029-${uid()}`,
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
        min_participants: 4,
        max_capacity: 10,
      })
      .select('id')
      .single(),
    'tour',
  );
  tourId = tour.id;

  const schedule = must(
    await service
      .from('tour_schedules')
      .insert({ tour_id: tourId, day_of_week: 2, start_time: '08:00', capacity: 10 })
      .select('id')
      .single(),
    'schedule',
  );
  const startsAt = new Date(Date.now() + DEPARTURE_LEAD_HOURS * HOUR_MS).toISOString();
  const instance = must(
    await service
      .from('tour_instances')
      .insert({
        tour_id: tourId,
        schedule_id: schedule.id,
        starts_at: startsAt,
        ends_at: startsAt,
        capacity_total: 10,
      })
      .select('id')
      .single(),
    'instance',
  );
  instanceId = instance.id;

  const staff = must(
    await service.from('users').select('id').eq('email', 'staff@bokatrails.com').single(),
    'staff',
  );
  staffId = staff.id;
});

afterAll(async () => {
  await deleteToursDeep(service, [tourId]);
});

describe('tours.auto_cancel_below_minimum', () => {
  it('defaults to staff decision (false) for a tour created without it', async () => {
    // Act
    const { data } = await service
      .from('tours')
      .select('auto_cancel_below_minimum')
      .eq('id', tourId)
      .single();

    // Assert
    expect(data?.auto_cancel_below_minimum).toBe(false);
  });
});

describe('bookings — reserva diferida (pending_minimum)', () => {
  it.each([
    ['saved card', { payment_method_id: null }],
    ['checkout customer', { customer_external_id: null }],
  ])('rejects a pending_minimum booking without its %s', async (_missing, missing) => {
    // Act
    const { error } = await service.from('bookings').insert(bookingRow(deferred(missing)));

    // Assert
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain('bookings_pending_minimum_has_card_check');
  });

  it('accepts a pending_minimum booking with server-obtained card data', async () => {
    // Act
    const id = await insertBooking(
      deferred({ card_brand: 'visa', card_last4: '4242', card_exp_month: 12, card_exp_year: 2030 }),
    );

    // Assert
    const { data } = await service
      .from('bookings')
      .select('status, charge_attempts, charge_started_at')
      .eq('id', id)
      .single();
    expect(data).toEqual({
      status: 'pending_minimum',
      charge_attempts: 0,
      charge_started_at: null,
    });
  });

  it.each([
    ['bookings_card_last4_check', { card_last4: '42a2' }],
    ['bookings_card_exp_month_check', { card_exp_month: 13 }],
    ['bookings_card_exp_year_check', { card_exp_year: 30 }],
    ['bookings_charge_attempts_check', { charge_attempts: -1 }],
  ])('rejects a value that violates %s', async (constraint, invalid) => {
    // Act
    const { error } = await service.from('bookings').insert(bookingRow(invalid));

    // Assert
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain(constraint);
  });

  it('rejects the same card on two live bookings', async () => {
    // Arrange
    const card = deferred();
    await insertBooking(card);

    // Act
    const { error } = await service
      .from('bookings')
      .insert(bookingRow({ status: 'pending_payment', payment_method_id: card.payment_method_id }));

    // Assert
    expect(error?.code).toBe(UNIQUE_VIOLATION);
    expect(error?.message).toContain('bookings_one_live_per_payment_method');
  });

  it('allows reusing a card once the earlier booking is no longer live', async () => {
    // Arrange
    const card = deferred();
    const earlier = await insertBooking(card);
    const cancel = await service.from('bookings').update({ status: 'cancelled' }).eq('id', earlier);
    expect(cancel.error).toBeNull();

    // Act
    const { error } = await service.from('bookings').insert(bookingRow(deferred(card)));

    // Assert
    expect(error).toBeNull();
  });

  it.each([
    ['total_amount_cents', { total_amount_cents: 1 }],
    ['currency', { currency: 'CRC' }],
  ])('rejects changing %s after the insert, even for service_role', async (_column, change) => {
    // Arrange
    const id = await insertBooking();

    // Act
    const { error } = await service.from('bookings').update(change).eq('id', id);

    // Assert
    expect(error?.message).toContain('BOOKING_MANDATE_IMMUTABLE');
    const { data } = await service
      .from('bookings')
      .select('total_amount_cents, currency')
      .eq('id', id)
      .single();
    expect(data).toEqual({ total_amount_cents: MANDATE_CENTS, currency: 'USD' });
  });

  it('allows updates that leave the mandate unchanged', async () => {
    // Arrange
    const id = await insertBooking();

    // Act
    const { error } = await service
      .from('bookings')
      .update({
        customer_name: 'Nombre corregido',
        total_amount_cents: MANDATE_CENTS,
        currency: 'USD',
      })
      .eq('id', id);

    // Assert
    expect(error).toBeNull();
  });
});

describe('payments — una sola fila pending por reserva', () => {
  async function insertPayment(bookingId: string, status: 'pending' | 'failed') {
    return service.from('payments').insert({
      booking_id: bookingId,
      external_payment_id: `pi_${crypto.randomUUID()}`,
      amount_cents: MANDATE_CENTS,
      status,
    });
  }

  it('rejects a second pending payment for the same booking', async () => {
    // Arrange
    const bookingId = await insertBooking();
    expect((await insertPayment(bookingId, 'pending')).error).toBeNull();

    // Act
    const { error } = await insertPayment(bookingId, 'pending');

    // Assert
    expect(error?.code).toBe(UNIQUE_VIOLATION);
    expect(error?.message).toContain('payments_one_pending_per_booking');
  });

  it('allows a new pending payment after the earlier one failed', async () => {
    // Arrange
    const bookingId = await insertBooking();
    expect((await insertPayment(bookingId, 'failed')).error).toBeNull();

    // Act
    const { error } = await insertPayment(bookingId, 'pending');

    // Assert
    expect(error).toBeNull();
  });
});

describe('notifications — CHECK de kind contra NotificationKind', () => {
  type Kind = Tables['notifications']['Insert']['kind'];
  // guide_assignment apunta a una salida y un guía, no a una reserva
  // (notifications_target_coherence): se cubre en guide-assignment.test.ts.
  const BOOKING_KINDS = Object.values(NotificationKind).filter(
    (kind) => kind !== NotificationKind.GuideAssignment,
  );

  function notificationFor(bookingId: string, kind: string) {
    return {
      booking_id: bookingId,
      kind: kind as Kind,
      recipient_email: 'turista@example.com',
      locale: 'es' as const,
      scheduled_for: now(),
    };
  }

  it.each(BOOKING_KINDS)('accepts every enum kind: %s', async (kind) => {
    // Arrange
    const bookingId = await insertBooking();

    // Act
    const { error } = await service.from('notifications').insert(notificationFor(bookingId, kind));

    // Assert
    expect(error).toBeNull();
  });

  it('rejects a kind outside the enum', async () => {
    // Arrange
    const bookingId = await insertBooking();

    // Act
    const { error } = await service
      .from('notifications')
      .insert(notificationFor(bookingId, 'charge_failed_action_required_4'));

    // Assert
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain('notifications_kind_check');
  });
});

describe('tour_instances — coherencia de la resolución del mínimo', () => {
  const CLEARED: InstanceUpdate = {
    minimum_resolution: null,
    minimum_resolved_at: null,
    minimum_resolved_by: null,
    minimum_charge_triggered_at: null,
    min_participants_at_trigger: null,
    seats_at_trigger: null,
  };

  // Estado coherente para cada resolución: disparo y snapshot solo al confirmar; actor solo
  // cuando decide el staff.
  function resolved(resolution: MinimumResolution): InstanceUpdate {
    const triggered =
      resolution === MinimumResolution.Reached || resolution === MinimumResolution.StaffConfirmed;
    const byStaff =
      resolution === MinimumResolution.StaffConfirmed ||
      resolution === MinimumResolution.StaffCancelled;
    return {
      minimum_resolution: resolution as InstanceUpdate['minimum_resolution'],
      minimum_resolved_at: now(),
      minimum_resolved_by: byStaff ? staffId : null,
      minimum_charge_triggered_at: triggered ? now() : null,
      min_participants_at_trigger: triggered ? 4 : null,
      seats_at_trigger: triggered ? 2 : null,
    };
  }

  afterEach(async () => {
    const { error } = await service.from('tour_instances').update(CLEARED).eq('id', instanceId);
    if (error) throw new Error(`reset instance: ${error.message}`);
  });

  it.each(Object.values(MinimumResolution))(
    'records a coherent %s resolution',
    async (resolution) => {
      // Act
      const { error } = await service
        .from('tour_instances')
        .update(resolved(resolution))
        .eq('id', instanceId);

      // Assert
      expect(error).toBeNull();
    },
  );

  it.each([
    [
      'tour_instances_minimum_resolution_check',
      () => ({ minimum_resolution: 'postponed', minimum_resolved_at: now() }),
    ],
    [
      'tour_instances_minimum_resolution_pair_check',
      () => ({ minimum_resolution: 'auto_cancelled' }),
    ],
    ['tour_instances_minimum_resolution_pair_check', () => ({ minimum_resolved_at: now() })],
    [
      'tour_instances_minimum_trigger_check',
      () => ({ ...resolved(MinimumResolution.StaffConfirmed), minimum_charge_triggered_at: null }),
    ],
    [
      'tour_instances_minimum_trigger_check',
      () => ({
        ...resolved(MinimumResolution.StaffCancelled),
        minimum_charge_triggered_at: now(),
        min_participants_at_trigger: 4,
        seats_at_trigger: 2,
      }),
    ],
    [
      'tour_instances_minimum_snapshot_check',
      () => ({ ...resolved(MinimumResolution.Reached), seats_at_trigger: null }),
    ],
    [
      'tour_instances_minimum_snapshot_check',
      () => ({ ...resolved(MinimumResolution.Reached), seats_at_trigger: -1 }),
    ],
    [
      'tour_instances_minimum_actor_check',
      () => ({ ...resolved(MinimumResolution.Reached), minimum_resolved_by: staffId }),
    ],
  ])('rejects an incoherent state that violates %s', async (constraint, state) => {
    // Act
    const { error } = await service
      .from('tour_instances')
      .update(state() as InstanceUpdate)
      .eq('id', instanceId);

    // Assert
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain(constraint);
  });
});
