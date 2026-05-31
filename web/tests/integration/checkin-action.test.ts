import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CheckInAction, CheckInError } from '@shared/constants/bookings';
import { toggleCheckIn } from '@/lib/booking/checkin-action';

// La Server Action depende de next/headers (vía requireAnyRole) y next/cache,
// que no existen en el runtime de vitest. Mockeamos solo esas fronteras: la
// escritura en DB (createSupabaseServiceClient) corre de verdad contra Postgres.
// vi.hoisted crea el mock fuera de la TDZ del hoisting de vi.mock.
const requireAnyRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/server', () => ({ requireAnyRole: requireAnyRoleMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let admin: SupabaseClient;
let staffUserId: string;
const createdTourIds: string[] = [];

async function seedBooking(status: string): Promise<string> {
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: `chk-${crypto.randomUUID()}`,
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

  const { data: instance } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tour!.id,
      schedule_id: schedule!.id,
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      ends_at: new Date(Date.now() + 90_000_000).toISOString(),
      capacity_total: 10,
      capacity_reserved: 1,
    })
    .select('id')
    .single();

  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instance!.id,
      customer_name: 'Cliente',
      customer_email: 'c@example.com',
      tickets_adult: 1,
      total_amount_cents: 5000,
      status,
    })
    .select('id')
    .single();

  return booking!.id;
}

async function readCheckIn(bookingId: string) {
  const { data } = await admin
    .from('bookings')
    .select('checked_in_at, checked_in_by')
    .eq('id', bookingId)
    .single();
  return data!;
}

describe('toggleCheckIn (server action, integration)', () => {
  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Usuario real del seed para satisfacer el FK checked_in_by -> users(id).
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
        await admin.from('bookings').delete().eq('tour_instance_id', inst.id);
      }
      await admin.from('tour_instances').delete().eq('tour_id', tourId);
      await admin.from('tour_schedules').delete().eq('tour_id', tourId);
      await admin.from('tours').delete().eq('id', tourId);
    }
  });

  it('marca el check-in de una reserva confirmed y registra al actor', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });
    const bookingId = await seedBooking('confirmed');

    const result = await toggleCheckIn(bookingId, CheckInAction.CheckIn);

    expect(result).toEqual({ ok: true });
    const row = await readCheckIn(bookingId);
    expect(row.checked_in_at).not.toBeNull();
    expect(row.checked_in_by).toBe(staffUserId);
  });

  it('es idempotente: marcar dos veces no cambia el timestamp original', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });
    const bookingId = await seedBooking('confirmed');

    await toggleCheckIn(bookingId, CheckInAction.CheckIn);
    const first = (await readCheckIn(bookingId)).checked_in_at;
    await toggleCheckIn(bookingId, CheckInAction.CheckIn);
    const second = (await readCheckIn(bookingId)).checked_in_at;

    expect(second).toBe(first);
  });

  it('revierte el check-in dejando los campos en null', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });
    const bookingId = await seedBooking('confirmed');
    await toggleCheckIn(bookingId, CheckInAction.CheckIn);

    const result = await toggleCheckIn(bookingId, CheckInAction.Revert);

    expect(result).toEqual({ ok: true });
    const row = await readCheckIn(bookingId);
    expect(row.checked_in_at).toBeNull();
    expect(row.checked_in_by).toBeNull();
  });

  it('rechaza el check-in sobre una reserva no confirmada', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });
    const bookingId = await seedBooking('pending_payment');

    const result = await toggleCheckIn(bookingId, CheckInAction.CheckIn);

    expect(result).toEqual({ ok: false, error: CheckInError.NotConfirmed });
    expect((await readCheckIn(bookingId)).checked_in_at).toBeNull();
  });

  it('rechaza si el usuario no tiene rol admin/staff', async () => {
    requireAnyRoleMock.mockRejectedValue(new Error('UNAUTHORIZED'));
    const bookingId = await seedBooking('confirmed');

    const result = await toggleCheckIn(bookingId, CheckInAction.CheckIn);

    expect(result).toEqual({ ok: false, error: CheckInError.Unauthorized });
    expect((await readCheckIn(bookingId)).checked_in_at).toBeNull();
  });

  it('devuelve NotFound si la reserva no existe', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });

    const result = await toggleCheckIn(crypto.randomUUID(), CheckInAction.CheckIn);

    expect(result).toEqual({ ok: false, error: CheckInError.NotFound });
  });
});
