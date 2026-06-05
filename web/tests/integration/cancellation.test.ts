import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CancellationError } from '@shared/constants/cancellations';
import { NotificationKind, NotificationStatus } from '@shared/constants/notifications';
import { RefundStatus } from '@shared/constants/refunds';
import { BookingStatus } from '@shared/constants/enums';
import { AuditAction } from '@shared/constants/audit';
import { hashBookingToken } from '@/lib/booking/booking-token-hash';

// server-only no resuelve en vitest; las Server Actions lo importan vía cancel.ts.
vi.mock('server-only', () => ({}));
const requireAnyRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/server', () => ({ requireAnyRole: requireAnyRoleMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { cancelByStaff, cancelByToken } = await import('@/lib/booking/cancel-action');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HOUR_MS = 60 * 60 * 1000;

let admin: SupabaseClient;
let staffUserId: string;
const createdTourIds: string[] = [];

type SeedOpts = { status?: string; hoursAhead?: number; withPayment?: boolean; reserved?: number };

async function seed(opts: SeedOpts = {}) {
  const {
    status = BookingStatus.Confirmed,
    hoursAhead = 48,
    withPayment = true,
    reserved = 3,
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
    })
    .select('id')
    .single();

  if (withPayment) {
    await admin.from('payments').insert({
      booking_id: booking!.id,
      external_provider: 'onvopay',
      external_payment_id: `pi_${crypto.randomUUID()}`,
      amount_cents: 9000,
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

async function bookingStatus(id: string) {
  const { data } = await admin.from('bookings').select('status').eq('id', id).single();
  return data!.status;
}
async function reservedSeats(instanceId: string) {
  const { data } = await admin
    .from('tour_instances')
    .select('capacity_reserved')
    .eq('id', instanceId)
    .single();
  return data!.capacity_reserved;
}

describe('cancellation flow (server actions, integration)', () => {
  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await admin.from('users').select('id').eq('role', 'staff').limit(1).single();
    staffUserId = data!.id;
  });

  afterEach(async () => {
    requireAnyRoleMock.mockReset();
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
          await admin.from('audit_logs').delete().eq('entity_id', b.id);
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
  });

  it('cancela con reembolso (>24h): libera cupo, cancela recordatorio, encola email y refund', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId, userRole: 'staff' });
    const { bookingId, instanceId } = await seed({ hoursAhead: 48, reserved: 3 });

    const result = await cancelByStaff(bookingId);

    expect(result).toEqual({ ok: true, refund: { eligible: true, amountCents: 9000 } });
    expect(await bookingStatus(bookingId)).toBe(BookingStatus.Cancelled);
    expect(await reservedSeats(instanceId)).toBe(0); // 3 reservados - 3 tickets

    const { data: reminder } = await admin
      .from('notifications')
      .select('status')
      .eq('booking_id', bookingId)
      .eq('kind', NotificationKind.Reminder24h)
      .single();
    expect(reminder!.status).toBe(NotificationStatus.Cancelled);

    const { data: cxlEmail } = await admin
      .from('notifications')
      .select('status')
      .eq('booking_id', bookingId)
      .eq('kind', NotificationKind.CancellationConfirmation)
      .single();
    expect(cxlEmail!.status).toBe(NotificationStatus.Pending);

    const { data: refund } = await admin
      .from('refunds')
      .select('status, amount_cents')
      .eq('booking_id', bookingId)
      .single();
    expect(refund).toEqual({ status: RefundStatus.Pending, amount_cents: 9000 });

    const { data: audits } = await admin
      .from('audit_logs')
      .select('action')
      .eq('entity_id', bookingId);
    const actions = (audits ?? []).map((a) => a.action);
    expect(actions).toContain(AuditAction.BookingCancelled);
    expect(actions).toContain(AuditAction.RefundRequested);
  });

  it('cancela sin reembolso (<24h): no crea refund pero sí encola el email', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId, userRole: 'staff' });
    const { bookingId } = await seed({ hoursAhead: 12 });

    const result = await cancelByStaff(bookingId);

    expect(result).toEqual({ ok: true, refund: { eligible: false, amountCents: 0 } });
    expect(await bookingStatus(bookingId)).toBe(BookingStatus.Cancelled);
    const { data: refunds } = await admin.from('refunds').select('id').eq('booking_id', bookingId);
    expect(refunds).toEqual([]);
    const { count } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .eq('kind', NotificationKind.CancellationConfirmation);
    expect(count).toBe(1);
  });

  it('es idempotente: la segunda cancelación no duplica refund', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId, userRole: 'staff' });
    const { bookingId } = await seed({ hoursAhead: 48 });

    await cancelByStaff(bookingId);
    const second = await cancelByStaff(bookingId);

    expect(second).toEqual({ ok: false, error: CancellationError.NotCancellable });
    const { count } = await admin
      .from('refunds')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId);
    expect(count).toBe(1);
  });

  it('cancela por token válido del turista', async () => {
    const { bookingId, token } = await seed({ hoursAhead: 48 });

    const result = await cancelByToken(token);

    expect(result.ok).toBe(true);
    expect(await bookingStatus(bookingId)).toBe(BookingStatus.Cancelled);
  });

  it('rechaza un token inválido sin tocar la reserva', async () => {
    const { bookingId } = await seed({ hoursAhead: 48 });

    const result = await cancelByToken(crypto.randomUUID());

    expect(result).toEqual({ ok: false, error: CancellationError.InvalidToken });
    expect(await bookingStatus(bookingId)).toBe(BookingStatus.Confirmed);
  });

  it('rechaza al staff sin rol', async () => {
    requireAnyRoleMock.mockRejectedValue(new Error('UNAUTHORIZED'));
    const { bookingId } = await seed({ hoursAhead: 48 });

    const result = await cancelByStaff(bookingId);

    expect(result).toEqual({ ok: false, error: CancellationError.Unauthorized });
    expect(await bookingStatus(bookingId)).toBe(BookingStatus.Confirmed);
  });

  it('rechaza cancelar una reserva no confirmada', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId, userRole: 'staff' });
    const { bookingId } = await seed({ status: BookingStatus.PendingPayment, withPayment: false });

    const result = await cancelByStaff(bookingId);

    expect(result).toEqual({ ok: false, error: CancellationError.NotCancellable });
  });
});
