// Fixtures de la operación que prometen los términos (spec 0035, migración …049). No es un test.
import { NotificationKind } from '@shared/constants/notifications';
import { BookingStatus } from '@shared/constants/enums';
import { HOUR_MS, isoFromNow, must, uid, type Db } from './deferred-fixtures';

export const BOOKING_TOTAL = 9000;
export const BOOKING_SEATS = 2;

export type TourFixture = { tourId: string; scheduleId: string };

/** Tour con la información de los términos y el mínimo pedido. */
export async function createTour(db: Db, minParticipants: number): Promise<TourFixture> {
  const tour = must(
    await db
      .from('tours')
      .insert({
        slug: `operacion-${uid()}`,
        name_es: 'Tour operación',
        name_en: 'Operations tour',
        description_es: 'd',
        description_en: 'd',
        difficulty: 'easy',
        duration_minutes: 60,
        meeting_point_es: 'Parque central',
        meeting_point_en: 'Central park',
        includes_es: 'g',
        includes_en: 'g',
        excludes_es: 'x',
        excludes_en: 'x',
        requirements_es: 'r',
        requirements_en: 'r',
        min_participants: minParticipants,
        max_capacity: 10,
      })
      .select('id')
      .single(),
    'tour',
  );
  const schedule = must(
    await db
      .from('tour_schedules')
      .insert({ tour_id: tour.id, day_of_week: 3, start_time: '08:00', capacity: 10 })
      .select('id')
      .single(),
    'schedule',
  );
  return { tourId: tour.id, scheduleId: schedule.id };
}

/** Salida del tour que empieza dentro de `startsInMs`. */
export async function createInstance(
  db: Db,
  tour: TourFixture,
  startsInMs: number,
  capacityTotal = 10,
): Promise<string> {
  const startsAt = isoFromNow(startsInMs);
  return must(
    await db
      .from('tour_instances')
      .insert({
        tour_id: tour.tourId,
        schedule_id: tour.scheduleId,
        starts_at: startsAt,
        ends_at: new Date(new Date(startsAt).getTime() + HOUR_MS).toISOString(),
        capacity_total: capacityTotal,
      })
      .select('id')
      .single(),
    'instance',
  ).id;
}

/**
 * Reserva cobrada del flujo inmediato, como la deja confirm_booking: pago `succeeded`, cupos en
 * capacity_reserved y recordatorio pendiente.
 */
export async function createPaidBooking(
  db: Db,
  instanceId: string,
  seats = BOOKING_SEATS,
): Promise<string> {
  const booking = must(
    await db
      .from('bookings')
      .insert({
        tour_instance_id: instanceId,
        customer_name: 'Turista',
        customer_email: `turista-${uid()}@example.com`,
        tickets_adult: seats,
        total_amount_cents: BOOKING_TOTAL,
        currency: 'USD',
        status: BookingStatus.Confirmed,
        locale: 'es',
      })
      .select('id, customer_email')
      .single(),
    'booking',
  );
  must(
    await db
      .from('payments')
      .insert({
        booking_id: booking.id,
        external_provider: 'onvopay',
        external_payment_id: `pi_${uid()}`,
        amount_cents: BOOKING_TOTAL,
        status: 'succeeded',
      })
      .select('id')
      .single(),
    'payment',
  );
  const { data: instance } = await db
    .from('tour_instances')
    .select('capacity_reserved, starts_at')
    .eq('id', instanceId)
    .single();
  await db
    .from('tour_instances')
    .update({ capacity_reserved: instance!.capacity_reserved + seats })
    .eq('id', instanceId);
  must(
    await db
      .from('notifications')
      .insert({
        booking_id: booking.id,
        kind: NotificationKind.Reminder24h,
        recipient_email: booking.customer_email,
        locale: 'es',
        scheduled_for: new Date(
          new Date(instance!.starts_at).getTime() - 24 * HOUR_MS,
        ).toISOString(),
      })
      .select('id')
      .single(),
    'reminder',
  );
  return booking.id;
}

/** Pago en curso en el widget: hold `paying`, reserva `pending_payment`, pago `pending`. */
export async function createPayingBooking(db: Db, instanceId: string): Promise<string> {
  const hold = must(
    await db
      .from('tour_holds')
      .insert({
        tour_instance_id: instanceId,
        session_token: crypto.randomUUID(),
        held_seats: 1,
        status: 'paying',
      })
      .select('id')
      .single(),
    'hold',
  );
  const booking = must(
    await db
      .from('bookings')
      .insert({
        tour_instance_id: instanceId,
        hold_id: hold.id,
        customer_name: 'Pagando',
        customer_email: `pagando-${uid()}@example.com`,
        tickets_adult: 1,
        total_amount_cents: 4500,
        currency: 'USD',
        status: BookingStatus.PendingPayment,
        locale: 'es',
      })
      .select('id')
      .single(),
    'paying booking',
  );
  must(
    await db
      .from('payments')
      .insert({
        booking_id: booking.id,
        external_provider: 'onvopay',
        external_payment_id: `pi_${uid()}`,
        amount_cents: 4500,
        status: 'pending',
      })
      .select('id')
      .single(),
    'pending payment',
  );
  return booking.id;
}

export async function readInstance(db: Db, instanceId: string) {
  return must(
    await db.from('tour_instances').select('*').eq('id', instanceId).single(),
    'readInstance',
  );
}

export async function refundsOf(db: Db, bookingId: string) {
  return must(
    await db
      .from('refunds')
      .select('id, status, amount_cents, method, transfer_channel')
      .eq('booking_id', bookingId),
    'refundsOf',
  );
}

/** Notificaciones de la reserva por kind, con su estado. */
export async function noticesOf(db: Db, bookingId: string): Promise<Record<string, string>> {
  const rows = must(
    await db.from('notifications').select('kind, status').eq('booking_id', bookingId),
    'noticesOf',
  );
  return Object.fromEntries(rows.map((r) => [r.kind, r.status]));
}
