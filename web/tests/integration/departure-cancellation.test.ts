// Cancelación de salidas y cierre por mínimo del cobro inmediato (spec 0035, migración …049):
// cancel_departure por cada motivo, resolve_immediate_minimum y keep_departure.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingStatus } from '@shared/constants/enums';
import { NotificationKind, NotificationStatus } from '@shared/constants/notifications';
import {
  CancelDepartureOutcome,
  DepartureCancellationReason,
  KeepDepartureOutcome,
} from '@shared/constants/operations';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';
import {
  createDeferredBooking,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  readBooking,
  userIdByEmail,
  type Db,
} from './deferred-fixtures';
import {
  BOOKING_TOTAL,
  createInstance,
  createPaidBooking,
  createPayingBooking,
  createTour,
  noticesOf,
  readInstance,
  refundsOf,
  type TourFixture,
} from './operations-fixtures';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const IN_WINDOW_MS = 24 * HOUR_MS + 30 * MINUTE_MS;
const tourIds: string[] = [];
let staffId: string;
let guideId: string;

async function tour(minParticipants: number): Promise<TourFixture> {
  const created = await createTour(db, minParticipants);
  tourIds.push(created.tourId);
  return created;
}

function cancelDeparture(instanceId: string, reason: string, actorId: string | null = staffId) {
  return db.rpc('cancel_departure', {
    p_instance_id: instanceId,
    p_reason: reason as never,
    p_actor_id: actorId,
  });
}

beforeAll(async () => {
  staffId = await userIdByEmail(db, 'staff@bokatrails.com');
  guideId = await userIdByEmail(db, 'carlos@bokatrails.com');
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

describe('cancel_departure — por falta de mínimo u otra causa', () => {
  it.each([DepartureCancellationReason.Minimum, DepartureCancellationReason.Other])(
    'con motivo %s reembolsa el 100 %% y manda un solo aviso',
    async (reason) => {
      // Arrange
      const instanceId = await createInstance(db, await tour(4), 3 * DAY_MS);
      const bookingId = await createPaidBooking(db, instanceId);

      // Act
      const { data, error } = await cancelDeparture(instanceId, reason);

      // Assert
      expect(error).toBeNull();
      expect(data).toBe(CancelDepartureOutcome.Cancelled);
      expect((await readBooking(db, bookingId)).status).toBe(BookingStatus.Cancelled);
      expect(await refundsOf(db, bookingId)).toEqual([
        expect.objectContaining({ amount_cents: BOOKING_TOTAL, status: 'pending' }),
      ]);
      const notices = await noticesOf(db, bookingId);
      expect(notices[NotificationKind.DepartureCancelled]).toBe(NotificationStatus.Pending);
      expect(notices[NotificationKind.CancellationConfirmation]).toBe(NotificationStatus.Cancelled);
      expect(notices[NotificationKind.Reminder24h]).toBe(NotificationStatus.Cancelled);

      const instance = await readInstance(db, instanceId);
      expect(instance.status).toBe('cancelled');
      expect(instance.cancellation_reason).toBe(reason);
      expect(instance.capacity_reserved).toBe(0);
    },
  );

  it('por mínimo estampa la resolución del staff', async () => {
    const instanceId = await createInstance(db, await tour(4), 3 * DAY_MS);

    await cancelDeparture(instanceId, DepartureCancellationReason.Minimum);

    const instance = await readInstance(db, instanceId);
    expect(instance.minimum_resolution).toBe('staff_cancelled');
    expect(instance.minimum_resolved_by).toBe(staffId);
  });

  it('no cancela por mínimo con menos de 24 h', async () => {
    const instanceId = await createInstance(db, await tour(4), 23 * HOUR_MS);

    const { data } = await cancelDeparture(instanceId, DepartureCancellationReason.Minimum);

    expect(data).toBe(CancelDepartureOutcome.MinimumTooLate);
    expect((await readInstance(db, instanceId)).status).not.toBe('cancelled');
  });

  it('con menos de 24 h sí cancela por otra causa, con el total', async () => {
    const instanceId = await createInstance(db, await tour(4), 5 * HOUR_MS);
    const bookingId = await createPaidBooking(db, instanceId);

    const { data } = await cancelDeparture(instanceId, DepartureCancellationReason.Other);

    expect(data).toBe(CancelDepartureOutcome.Cancelled);
    expect((await refundsOf(db, bookingId))[0]?.amount_cents).toBe(BOOKING_TOTAL);
  });

  it('es idempotente', async () => {
    const instanceId = await createInstance(db, await tour(4), 3 * DAY_MS);
    await cancelDeparture(instanceId, DepartureCancellationReason.Other);

    const { data } = await cancelDeparture(instanceId, DepartureCancellationReason.Other);

    expect(data).toBe(CancelDepartureOutcome.AlreadyCancelled);
  });

  it('una salida ya empezada no se cancela', async () => {
    const instanceId = await createInstance(db, await tour(4), -HOUR_MS);

    const { data } = await cancelDeparture(instanceId, DepartureCancellationReason.Other);

    expect(data).toBe(CancelDepartureOutcome.AlreadyStarted);
  });
});

describe('cancel_departure — clima o seguridad', () => {
  it.each([DepartureCancellationReason.Weather, DepartureCancellationReason.Safety])(
    'con motivo %s deja la reserva en revisión, sin reembolso',
    async (reason) => {
      // Arrange
      const instanceId = await createInstance(db, await tour(4), 3 * DAY_MS);
      const bookingId = await createPaidBooking(db, instanceId);

      // Act
      await cancelDeparture(instanceId, reason);

      // Assert
      const booking = await readBooking(db, bookingId);
      expect(booking.status).toBe(BookingStatus.Confirmed);
      expect(booking.operator_review_required_at).not.toBeNull();
      expect(await refundsOf(db, bookingId)).toEqual([]);
      const notices = await noticesOf(db, bookingId);
      expect(notices[NotificationKind.DepartureCancelled]).toBe(NotificationStatus.Pending);
      expect(notices[NotificationKind.Reminder24h]).toBe(NotificationStatus.Cancelled);
      expect((await readInstance(db, instanceId)).minimum_resolution).toBeNull();
    },
  );
});

describe('cancel_departure — reservas sin cobrar', () => {
  it('cancela el pago en curso del widget y libera su hold', async () => {
    const instanceId = await createInstance(db, await tour(4), 3 * DAY_MS);
    const bookingId = await createPayingBooking(db, instanceId);

    await cancelDeparture(instanceId, DepartureCancellationReason.Other);

    const booking = await readBooking(db, bookingId);
    expect(booking.status).toBe(BookingStatus.Cancelled);
    const { data: payment } = await db
      .from('payments')
      .select('status')
      .eq('booking_id', bookingId)
      .single();
    expect(payment!.status).toBe('failed');
    const { data: hold } = await db
      .from('tour_holds')
      .select('status')
      .eq('id', booking.hold_id!)
      .single();
    expect(hold!.status).toBe('released');
    expect((await noticesOf(db, bookingId))[NotificationKind.DepartureCancelled]).toBe(
      NotificationStatus.Pending,
    );
  });

  it('una reserva del cobro diferido recibe el aviso nuevo en lugar del de mínimo', async () => {
    const instanceId = await createInstance(db, await tour(4), 3 * DAY_MS);
    const { bookingId } = await createDeferredBooking(db, instanceId);

    await cancelDeparture(instanceId, DepartureCancellationReason.Weather);

    expect((await readBooking(db, bookingId)).status).toBe(BookingStatus.Cancelled);
    const notices = await noticesOf(db, bookingId);
    expect(notices[NotificationKind.DepartureCancelled]).toBe(NotificationStatus.Pending);
    expect(notices[NotificationKind.DepartureCancelledMinimum]).toBe(NotificationStatus.Cancelled);
  });
});

describe('cancel_departure — permisos', () => {
  it('sin actor solo acepta el motivo de mínimo', async () => {
    const instanceId = await createInstance(db, await tour(4), 3 * DAY_MS);

    const { error } = await cancelDeparture(instanceId, DepartureCancellationReason.Other, null);

    expect(error?.message).toContain('ACTOR_REQUIRED');
  });

  it('rechaza un actor que no es admin ni staff', async () => {
    const instanceId = await createInstance(db, await tour(4), 3 * DAY_MS);

    const { error } = await cancelDeparture(instanceId, DepartureCancellationReason.Other, guideId);

    expect(error?.message).toContain('INVALID_ACTOR');
  });
});

describe('resolve_immediate_minimum', () => {
  it('con los cupos cobrados en el mínimo la resuelve como alcanzada', async () => {
    const instanceId = await createInstance(db, await tour(2), IN_WINDOW_MS);
    await createPaidBooking(db, instanceId, 2);

    const { data } = await db.rpc('resolve_immediate_minimum', { p_instance_id: instanceId });

    expect(data).toBe('reached');
    const instance = await readInstance(db, instanceId);
    expect(instance.minimum_resolution).toBe('reached');
    expect(instance.status).not.toBe('cancelled');
  });

  it('con mínimo 1 la resuelve alcanzada aunque esté vacía', async () => {
    const instanceId = await createInstance(db, await tour(1), IN_WINDOW_MS);

    const { data } = await db.rpc('resolve_immediate_minimum', { p_instance_id: instanceId });

    expect(data).toBe('reached');
  });

  it('bajo el mínimo la cancela con reembolso total y sin actor', async () => {
    const instanceId = await createInstance(db, await tour(4), IN_WINDOW_MS);
    const bookingId = await createPaidBooking(db, instanceId, 2);

    const { data } = await db.rpc('resolve_immediate_minimum', { p_instance_id: instanceId });

    expect(data).toBe('cancelled');
    const instance = await readInstance(db, instanceId);
    expect(instance.minimum_resolution).toBe('auto_cancelled');
    expect(instance.cancellation_reason).toBe('minimum');
    expect((await refundsOf(db, bookingId))[0]?.amount_cents).toBe(BOOKING_TOTAL);
  });

  it('cancela también una salida vacía bajo el mínimo', async () => {
    const instanceId = await createInstance(db, await tour(4), IN_WINDOW_MS);

    const { data } = await db.rpc('resolve_immediate_minimum', { p_instance_id: instanceId });

    expect(data).toBe('cancelled');
  });

  it.each([
    ['con menos de 24 h', 23 * HOUR_MS],
    ['con más de 25 h', 26 * HOUR_MS],
  ])('no la toca %s', async (_case, startsInMs) => {
    const instanceId = await createInstance(db, await tour(4), startsInMs);

    const { data } = await db.rpc('resolve_immediate_minimum', { p_instance_id: instanceId });

    expect(data).toBe('not_due');
    expect((await readInstance(db, instanceId)).minimum_resolved_at).toBeNull();
  });

  it('saltea una salida con reservas del cobro diferido', async () => {
    const instanceId = await createInstance(db, await tour(4), IN_WINDOW_MS);
    await createDeferredBooking(db, instanceId);

    const { data } = await db.rpc('resolve_immediate_minimum', { p_instance_id: instanceId });

    expect(data).toBe('deferred_flow');
  });
});

describe('keep_departure', () => {
  it('la resuelve como confirmada por el staff y el proceso ya no la toca', async () => {
    const instanceId = await createInstance(db, await tour(4), IN_WINDOW_MS);

    const kept = await db.rpc('keep_departure', { p_instance_id: instanceId, p_actor_id: staffId });
    const resolved = await db.rpc('resolve_immediate_minimum', { p_instance_id: instanceId });

    expect(kept.data).toBe(KeepDepartureOutcome.Resolved);
    expect(resolved.data).toBe('already_resolved');
    const instance = await readInstance(db, instanceId);
    expect(instance.minimum_resolution).toBe('staff_confirmed');
    expect(instance.status).not.toBe('cancelled');
  });

  it('después de mantenerla ya no se cancela por mínimo', async () => {
    const instanceId = await createInstance(db, await tour(4), 3 * DAY_MS);
    await db.rpc('keep_departure', { p_instance_id: instanceId, p_actor_id: staffId });

    const { data } = await cancelDeparture(instanceId, DepartureCancellationReason.Minimum);

    expect(data).toBe(CancelDepartureOutcome.AlreadyResolved);
  });
});
