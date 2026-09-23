// Fixtures de las suites de cancelación (specs 0011 y 0032). No es un test.
import type { SupabaseClient } from '@supabase/supabase-js';
import { NotificationKind } from '@shared/constants/notifications';
import { BookingStatus } from '@shared/constants/enums';
import { hashBookingToken } from '@/lib/booking/booking-token-hash';

export const HOUR_MS = 60 * 60 * 1000;

const createdTourIds: string[] = [];

export type SeedOpts = {
  status?: string;
  hoursAhead?: number;
  withPayment?: boolean;
  reserved?: number;
  paymentAmountCents?: number;
  /** `bookings.terms_version` (spec 0032). */
  termsVersion?: string | null;
};

export async function seed(admin: SupabaseClient, opts: SeedOpts = {}) {
  const {
    status = BookingStatus.Confirmed,
    hoursAhead = 48,
    withPayment = true,
    reserved = 3,
    paymentAmountCents = 9000,
    termsVersion = null,
  } = opts;
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: `cxl-${crypto.randomUUID()}`,
      name_es: 'Tour ES',
      name_en: 'Tour EN',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'm',
      meeting_point_en: 'm',
      includes_es: 'i',
      includes_en: 'i',
      min_participants: 1,
      max_capacity: 10,
    })
    .select('id')
    .single();
  createdTourIds.push(tour!.id);

  const { data: schedule } = await admin
    .from('tour_schedules')
    .insert({
      tour_id: tour!.id,
      day_of_week: 1,
      start_time: '09:00:00',
      capacity: 10,
      valid_from: '2026-01-01',
    })
    .select('id')
    .single();

  const startsAt = new Date(Date.now() + hoursAhead * HOUR_MS);
  const { data: instance } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tour!.id,
      schedule_id: schedule!.id,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + HOUR_MS).toISOString(),
      capacity_total: 10,
      capacity_reserved: reserved,
    })
    .select('id')
    .single();

  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instance!.id,
      customer_name: 'Cliente',
      customer_email: 'c@example.com',
      tickets_adult: 2,
      tickets_child: 1,
      total_amount_cents: 9000,
      currency: 'USD',
      status,
      locale: 'es',
      terms_accepted_at: termsVersion ? new Date().toISOString() : null,
      terms_version: termsVersion,
    })
    .select('id')
    .single();

  if (withPayment) {
    await admin.from('payments').insert({
      booking_id: booking!.id,
      external_provider: 'onvopay',
      external_payment_id: `pi_${crypto.randomUUID()}`,
      amount_cents: paymentAmountCents,
      status: 'succeeded',
    });
  }

  // Recordatorio pendiente (debe cancelarse al cancelar la reserva).
  await admin.from('notifications').insert({
    booking_id: booking!.id,
    kind: NotificationKind.Reminder24h,
    recipient_email: 'c@example.com',
    locale: 'es',
    scheduled_for: startsAt.toISOString(),
  });

  const token = crypto.randomUUID();
  await admin.from('booking_access_tokens').insert({
    booking_id: booking!.id,
    token_hash: hashBookingToken(token),
    expires_at: startsAt.toISOString(),
  });

  return { bookingId: booking!.id, instanceId: instance!.id, token };
}

export async function bookingStatus(admin: SupabaseClient, id: string) {
  const { data } = await admin.from('bookings').select('status').eq('id', id).single();
  return data!.status;
}
export async function reservedSeats(admin: SupabaseClient, instanceId: string) {
  const { data } = await admin
    .from('tour_instances')
    .select('capacity_reserved')
    .eq('id', instanceId)
    .single();
  return data!.capacity_reserved;
}

/** Borra los tours creados por `seed` y su descendencia (audit_logs es append-only). */
export async function cleanupSeeds(admin: SupabaseClient): Promise<void> {
  while (createdTourIds.length) {
    const tourId = createdTourIds.pop()!;
    const { data: instances } = await admin
      .from('tour_instances')
      .select('id')
      .eq('tour_id', tourId);
    for (const inst of instances ?? []) {
      const { data: bks } = await admin
        .from('bookings')
        .select('id')
        .eq('tour_instance_id', inst.id);
      for (const b of bks ?? []) {
        // audit_logs es append-only (trigger de inmutabilidad): no se borra.
        await admin.from('refunds').delete().eq('booking_id', b.id);
        await admin.from('booking_access_tokens').delete().eq('booking_id', b.id);
        await admin.from('notifications').delete().eq('booking_id', b.id);
        await admin.from('payments').delete().eq('booking_id', b.id);
      }
      await admin.from('bookings').delete().eq('tour_instance_id', inst.id);
    }
    await admin.from('tour_instances').delete().eq('tour_id', tourId);
    await admin.from('tour_schedules').delete().eq('tour_id', tourId);
    await admin.from('tours').delete().eq('id', tourId);
  }
}
