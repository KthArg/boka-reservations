// Reservas en revisión, cambio de fecha, punto de encuentro fijo y devolución por transferencia
// (spec 0035, migración …049).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingStatus } from '@shared/constants/enums';
import { NotificationKind, NotificationStatus } from '@shared/constants/notifications';
import {
  DepartureCancellationReason,
  RescheduleOutcome,
  ReviewDecisionOutcome,
  TransferRequestOutcome,
  TransferSettleOutcome,
} from '@shared/constants/operations';
import { RefundStatus, TransferChannel } from '@shared/constants/refunds';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';
import { DAY_MS, HOUR_MS, must, readBooking, userIdByEmail, type Db } from './deferred-fixtures';
import {
  BOOKING_SEATS,
  BOOKING_TOTAL,
  createInstance,
  createPaidBooking,
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

const tourIds: string[] = [];
let staffId: string;

async function tour(): Promise<TourFixture> {
  const created = await createTour(db, 1);
  tourIds.push(created.tourId);
  return created;
}

/** Reserva cobrada en una salida cancelada por clima: queda en revisión. */
async function reviewedBooking(): Promise<{
  bookingId: string;
  instanceId: string;
  t: TourFixture;
}> {
  const t = await tour();
  const instanceId = await createInstance(db, t, 3 * DAY_MS);
  const bookingId = await createPaidBooking(db, instanceId);
  must(
    await db.rpc('cancel_departure', {
      p_instance_id: instanceId,
      p_reason: DepartureCancellationReason.Weather,
      p_actor_id: staffId,
    }),
    'cancel_departure',
  );
  return { bookingId, instanceId, t };
}

function reschedule(bookingId: string, targetId: string) {
  return db.rpc('reschedule_booking', {
    p_booking_id: bookingId,
    p_target_instance_id: targetId,
    p_actor_id: staffId,
  });
}

/**
 * Reembolso fallido como lo deja el worker cuando OnvoPay lo rechaza de forma definitiva: con id
 * externo y el motivo del proveedor. `externalId: null` simula un POST que falló sin id.
 */
async function failedRefund(
  failureReason = 'card_declined',
  externalId: string | null = `re_${crypto.randomUUID()}`,
) {
  const t = await tour();
  const instanceId = await createInstance(db, t, 3 * DAY_MS);
  const bookingId = await createPaidBooking(db, instanceId);
  must(
    await db.rpc('cancel_departure', {
      p_instance_id: instanceId,
      p_reason: DepartureCancellationReason.Other,
      p_actor_id: staffId,
    }),
    'cancel_departure',
  );
  const refund = (await refundsOf(db, bookingId))[0]!;
  await db
    .from('refunds')
    .update({
      status: RefundStatus.Failed,
      failure_reason: failureReason,
      external_refund_id: externalId,
    })
    .eq('id', refund.id);
  return { bookingId, refundId: refund.id };
}

beforeAll(async () => {
  staffId = await userIdByEmail(db, 'staff@bokatrails.com');
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

describe('decisiones sobre reservas en revisión', () => {
  it('reembolsar el 100 % cancela la reserva, encola el total y quita la marca', async () => {
    const { bookingId } = await reviewedBooking();

    const { data } = await db.rpc('refund_reviewed_booking', {
      p_booking_id: bookingId,
      p_actor_id: staffId,
    });

    expect(data).toBe(ReviewDecisionOutcome.Refunded);
    const booking = await readBooking(db, bookingId);
    expect(booking.status).toBe(BookingStatus.Cancelled);
    expect(booking.operator_review_required_at).toBeNull();
    expect((await refundsOf(db, bookingId))[0]?.amount_cents).toBe(BOOKING_TOTAL);
    expect((await noticesOf(db, bookingId))[NotificationKind.CancellationConfirmation]).toBe(
      NotificationStatus.Pending,
    );
  });

  it('cerrar sin reembolso cancela la reserva sin encolar reembolso', async () => {
    const { bookingId, instanceId } = await reviewedBooking();

    const { data } = await db.rpc('close_reviewed_booking_without_refund', {
      p_booking_id: bookingId,
      p_actor_id: staffId,
    });

    expect(data).toBe(ReviewDecisionOutcome.Closed);
    expect((await readBooking(db, bookingId)).status).toBe(BookingStatus.Cancelled);
    expect(await refundsOf(db, bookingId)).toEqual([]);
    expect((await readInstance(db, instanceId)).capacity_reserved).toBe(0);
    expect((await noticesOf(db, bookingId))[NotificationKind.CancellationConfirmation]).toBe(
      NotificationStatus.Pending,
    );
  });

  it('una reserva sin la marca no se decide', async () => {
    const instanceId = await createInstance(db, await tour(), 3 * DAY_MS);
    const bookingId = await createPaidBooking(db, instanceId);

    const { data } = await db.rpc('refund_reviewed_booking', {
      p_booking_id: bookingId,
      p_actor_id: staffId,
    });

    expect(data).toBe(ReviewDecisionOutcome.NotUnderReview);
    expect((await readBooking(db, bookingId)).status).toBe(BookingStatus.Confirmed);
  });
});

describe('reschedule_booking', () => {
  it('mueve la reserva, los cupos y el recordatorio, sin tocar la plata', async () => {
    // Arrange
    const t = await tour();
    const sourceId = await createInstance(db, t, 3 * DAY_MS);
    const targetId = await createInstance(db, t, 6 * DAY_MS);
    const bookingId = await createPaidBooking(db, sourceId);

    // Act
    const { data } = await reschedule(bookingId, targetId);

    // Assert
    expect(data).toBe(RescheduleOutcome.Rescheduled);
    const booking = await readBooking(db, bookingId);
    expect(booking.tour_instance_id).toBe(targetId);
    expect(booking.total_amount_cents).toBe(BOOKING_TOTAL);
    expect((await readInstance(db, sourceId)).capacity_reserved).toBe(0);
    expect((await readInstance(db, targetId)).capacity_reserved).toBe(BOOKING_SEATS);
    expect(await refundsOf(db, bookingId)).toEqual([]);

    const { data: reminder } = await db
      .from('notifications')
      .select('status, scheduled_for')
      .eq('booking_id', bookingId)
      .eq('kind', NotificationKind.Reminder24h)
      .single();
    const target = await readInstance(db, targetId);
    expect(reminder!.status).toBe(NotificationStatus.Pending);
    expect(new Date(reminder!.scheduled_for).getTime()).toBe(
      new Date(target.starts_at).getTime() - 24 * HOUR_MS,
    );
    expect((await noticesOf(db, bookingId))[NotificationKind.BookingRescheduled]).toBe(
      NotificationStatus.Pending,
    );
  });

  it('reprograma un recordatorio que ya había salido', async () => {
    const t = await tour();
    const sourceId = await createInstance(db, t, 3 * DAY_MS);
    const targetId = await createInstance(db, t, 6 * DAY_MS);
    const bookingId = await createPaidBooking(db, sourceId);
    await db
      .from('notifications')
      .update({ status: NotificationStatus.Sent, sent_at: new Date().toISOString() })
      .eq('booking_id', bookingId)
      .eq('kind', NotificationKind.Reminder24h);

    await reschedule(bookingId, targetId);

    expect((await noticesOf(db, bookingId))[NotificationKind.Reminder24h]).toBe(
      NotificationStatus.Pending,
    );
  });

  it('una reserva en revisión pasa a la otra fecha y pierde la marca', async () => {
    const { bookingId, t } = await reviewedBooking();
    const targetId = await createInstance(db, t, 6 * DAY_MS);

    const { data } = await reschedule(bookingId, targetId);

    expect(data).toBe(RescheduleOutcome.Rescheduled);
    const booking = await readBooking(db, bookingId);
    expect(booking.operator_review_required_at).toBeNull();
    expect(booking.status).toBe(BookingStatus.Confirmed);
  });

  it('cuenta los holds vivos del destino al medir el cupo', async () => {
    const t = await tour();
    const sourceId = await createInstance(db, t, 3 * DAY_MS);
    const targetId = await createInstance(db, t, 6 * DAY_MS, 3);
    const bookingId = await createPaidBooking(db, sourceId);
    await db.from('tour_holds').insert({
      tour_instance_id: targetId,
      session_token: crypto.randomUUID(),
      held_seats: 2,
    });

    const { data } = await reschedule(bookingId, targetId);

    expect(data).toBe(RescheduleOutcome.NoCapacity);
    expect((await readBooking(db, bookingId)).tour_instance_id).toBe(sourceId);
  });

  it('rechaza otro tour, la misma salida y una salida cancelada', async () => {
    const t = await tour();
    const sourceId = await createInstance(db, t, 3 * DAY_MS);
    const bookingId = await createPaidBooking(db, sourceId);
    const otherTourId = await createInstance(db, await tour(), 6 * DAY_MS);
    const cancelledId = await createInstance(db, t, 6 * DAY_MS);
    await db.from('tour_instances').update({ status: 'cancelled' }).eq('id', cancelledId);

    expect((await reschedule(bookingId, sourceId)).data).toBe(RescheduleOutcome.SameInstance);
    expect((await reschedule(bookingId, otherTourId)).data).toBe(RescheduleOutcome.DifferentTour);
    expect((await reschedule(bookingId, cancelledId)).data).toBe(
      RescheduleOutcome.TargetUnavailable,
    );
    expect((await readBooking(db, bookingId)).tour_instance_id).toBe(sourceId);
  });
});

describe('punto de encuentro fijo', () => {
  it('no cambia con reservas confirmadas en salidas futuras', async () => {
    const t = await tour();
    const instanceId = await createInstance(db, t, 3 * DAY_MS);
    await createPaidBooking(db, instanceId);

    const { error } = await db
      .from('tours')
      .update({ meeting_point_es: 'Otro lugar' })
      .eq('id', t.tourId);

    expect(error?.message).toContain('MEETING_POINT_LOCKED');
  });

  it('cambia libremente sin reservas futuras, y el resto del tour siempre', async () => {
    const t = await tour();
    const instanceId = await createInstance(db, t, 3 * DAY_MS);
    await createPaidBooking(db, instanceId);

    const other = await db.from('tours').update({ name_es: 'Nombre nuevo' }).eq('id', t.tourId);
    const fresh = await tour();
    const moved = await db
      .from('tours')
      .update({ meeting_point_es: 'Otro lugar' })
      .eq('id', fresh.tourId);

    expect(other.error).toBeNull();
    expect(moved.error).toBeNull();
  });
});

async function settle(refundId: string, overrides: Record<string, unknown> = {}) {
  // La transferencia se registra a la hora del pedido: nunca va adelante del reloj de la base y
  // cae el mismo día de Costa Rica. "Un minuto antes de ahora" fallaba en el primer minuto del día
  // (INVALID_PAID_AT por quedar el día anterior al pedido). Sin pedido, un minuto antes de ahora.
  const { data } = await db
    .from('refunds')
    .select('transfer_requested_at')
    .eq('id', refundId)
    .single();
  const paidAt = data?.transfer_requested_at ?? new Date(Date.now() - 60_000).toISOString();
  return db.rpc('settle_refund_transfer', {
    p_refund_id: refundId,
    p_actor_id: staffId,
    p_channel: TransferChannel.SinpeMovil,
    p_reference: 'SINPE-123456',
    p_paid_at: paidAt,
    p_amount_cents: BOOKING_TOTAL,
    p_currency: 'USD',
    ...overrides,
  } as never);
}

describe('devolución por transferencia', () => {
  it('pedida y registrada, deja la reserva reembolsada y avisa al turista', async () => {
    // Arrange
    const { bookingId, refundId } = await failedRefund();

    // Act
    const requested = await db.rpc('request_refund_transfer', {
      p_refund_id: refundId,
      p_actor_id: staffId,
    });
    const settled = await settle(refundId);

    // Assert
    expect(requested.data).toBe(TransferRequestOutcome.Requested);
    expect(settled.data).toBe(TransferSettleOutcome.Settled);
    expect(await refundsOf(db, bookingId)).toEqual([
      expect.objectContaining({
        status: RefundStatus.Succeeded,
        method: 'transfer',
        transfer_channel: TransferChannel.SinpeMovil,
      }),
    ]);
    expect((await readBooking(db, bookingId)).status).toBe(BookingStatus.Refunded);
    const notices = await noticesOf(db, bookingId);
    expect(notices[NotificationKind.RefundTransferRequest]).toBe(NotificationStatus.Pending);
    expect(notices[NotificationKind.RefundConfirmation]).toBe(NotificationStatus.Pending);
  });

  it('en colones guarda lo que se transfirió', async () => {
    const { refundId } = await failedRefund();
    await db.rpc('request_refund_transfer', { p_refund_id: refundId, p_actor_id: staffId });

    const { data } = await settle(refundId, { p_amount_cents: 4_650_000, p_currency: 'CRC' });

    expect(data).toBe(TransferSettleOutcome.Settled);
    const { data: row } = await db
      .from('refunds')
      .select('transfer_amount_cents, transfer_currency')
      .eq('id', refundId)
      .single();
    expect(row).toEqual({ transfer_amount_cents: 4_650_000, transfer_currency: 'CRC' });
  });

  it('en dólares exige exactamente lo reembolsado', async () => {
    const { refundId } = await failedRefund();
    await db.rpc('request_refund_transfer', { p_refund_id: refundId, p_actor_id: staffId });

    const { error } = await settle(refundId, { p_amount_cents: BOOKING_TOTAL - 1 });

    expect(error?.message).toContain('INVALID_AMOUNT');
  });

  it.each(['processing-stale', 'ambiguous-timeout', 'processing-timeout'])(
    'no se pide si el resultado en OnvoPay es desconocido (%s)',
    async (reason) => {
      const { refundId } = await failedRefund(reason);

      const { data } = await db.rpc('request_refund_transfer', {
        p_refund_id: refundId,
        p_actor_id: staffId,
      });

      expect(data).toBe(TransferRequestOutcome.ProviderMaySettle);
    },
  );

  it('no se pide si el POST falló sin id: OnvoPay pudo haberlo creado', async () => {
    const { refundId } = await failedRefund('onvopay createRefund 502: bad gateway', null);

    const { data } = await db.rpc('request_refund_transfer', {
      p_refund_id: refundId,
      p_actor_id: staffId,
    });

    expect(data).toBe(TransferRequestOutcome.ProviderMaySettle);
  });

  it('se pide si OnvoPay no encontró el pago, aunque no haya id', async () => {
    const { refundId } = await failedRefund('payment-intent-missing', null);

    const { data } = await db.rpc('request_refund_transfer', {
      p_refund_id: refundId,
      p_actor_id: staffId,
    });

    expect(data).toBe(TransferRequestOutcome.Requested);
  });

  it('no se pide sobre un reembolso que no falló', async () => {
    const { refundId } = await failedRefund();
    await db.from('refunds').update({ status: RefundStatus.Pending }).eq('id', refundId);

    const { data } = await db.rpc('request_refund_transfer', {
      p_refund_id: refundId,
      p_actor_id: staffId,
    });

    expect(data).toBe(TransferRequestOutcome.NotFailed);
  });

  it('no se registra sin haberla pedido, ni con fecha futura', async () => {
    const { refundId } = await failedRefund();

    const notRequested = await settle(refundId);
    await db.rpc('request_refund_transfer', { p_refund_id: refundId, p_actor_id: staffId });
    const future = await settle(refundId, {
      p_paid_at: new Date(Date.now() + DAY_MS).toISOString(),
    });

    expect(notRequested.data).toBe(TransferSettleOutcome.NotAwaitingTransfer);
    expect(future.error?.message).toContain('INVALID_PAID_AT');
  });

  it('registrarla dos veces a la vez la asienta una sola vez', async () => {
    const { bookingId, refundId } = await failedRefund();
    await db.rpc('request_refund_transfer', { p_refund_id: refundId, p_actor_id: staffId });

    const results = await Promise.all([settle(refundId), settle(refundId)]);

    expect(results.map((r) => r.data).sort()).toEqual([
      TransferSettleOutcome.NotAwaitingTransfer,
      TransferSettleOutcome.Settled,
    ]);
    const { count } = await db
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', bookingId)
      .eq('action', 'refund.succeeded');
    expect(count).toBe(1);
  });
});

describe('concurrencia', () => {
  it('dos cambios de fecha por el último cupo: entra uno solo', async () => {
    const t = await tour();
    const target = await createInstance(db, t, 6 * DAY_MS, 2);
    const first = await createPaidBooking(db, await createInstance(db, t, 3 * DAY_MS));
    const second = await createPaidBooking(db, await createInstance(db, t, 4 * DAY_MS));

    const results = await Promise.all([reschedule(first, target), reschedule(second, target)]);

    expect(results.map((r) => r.data).sort()).toEqual([
      RescheduleOutcome.NoCapacity,
      RescheduleOutcome.Rescheduled,
    ]);
    expect((await readInstance(db, target)).capacity_reserved).toBe(BOOKING_SEATS);
  });
});

describe('reprogramar un aviso', () => {
  it('un segundo cambio de fecha vuelve a encolar el aviso con otra generación', async () => {
    const t = await tour();
    const bookingId = await createPaidBooking(db, await createInstance(db, t, 3 * DAY_MS));
    await reschedule(bookingId, await createInstance(db, t, 5 * DAY_MS));
    await db
      .from('notifications')
      .update({ status: NotificationStatus.Sent })
      .eq('booking_id', bookingId)
      .eq('kind', NotificationKind.BookingRescheduled);

    await reschedule(bookingId, await createInstance(db, t, 7 * DAY_MS));

    const { data } = await db
      .from('notifications')
      .select('status, generation')
      .eq('booking_id', bookingId)
      .eq('kind', NotificationKind.BookingRescheduled)
      .single();
    expect(data).toEqual({ status: NotificationStatus.Pending, generation: 1 });
  });
});

describe('reschedule_booking — otros resultados', () => {
  it('rechaza una reserva que no está confirmada y una salida de origen ya empezada', async () => {
    const t = await tour();
    const target = await createInstance(db, t, 6 * DAY_MS);
    const cancelled = await createPaidBooking(db, await createInstance(db, t, 3 * DAY_MS));
    await db.from('bookings').update({ status: BookingStatus.Cancelled }).eq('id', cancelled);
    const started = await createPaidBooking(db, await createInstance(db, t, -HOUR_MS));

    expect((await reschedule(cancelled, target)).data).toBe(RescheduleOutcome.NotConfirmed);
    expect((await reschedule(started, target)).data).toBe(RescheduleOutcome.SourceStarted);
  });
});

describe('cancel_booking sobre una reserva en revisión', () => {
  it('devuelve under_review sin tocar nada', async () => {
    const { bookingId } = await reviewedBooking();

    const { data, error } = await db.rpc('cancel_booking', {
      p_booking_id: bookingId,
      p_actor_type: 'tourist',
      p_refund_amount_cents: 0,
      p_reason: 'customer_request',
      p_fee_cents: 0,
    });

    expect(error).toBeNull();
    expect(data).toBe('under_review');
    expect((await readBooking(db, bookingId)).status).toBe(BookingStatus.Confirmed);
  });
});
