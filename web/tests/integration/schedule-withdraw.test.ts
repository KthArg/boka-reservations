// Retiro de salidas fuera de vigencia al guardar un tour (spec 0044) — contra DB real. Lo que estas
// pruebas protegen: nunca se retira una salida con algo vivo encima (reservas, apartados o un
// ciclo de cobro abierto), y el día se cuenta en hora de Costa Rica.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const tourIds: string[] = [];
let adminId: string;
let staffId: string;

/** Día calendario de Costa Rica (UTC−6, sin horario de verano) de un instante. */
const crDay = (ms: number) => new Date(ms - 6 * HOUR_MS).toISOString().slice(0, 10);

async function tourWithSchedule(schedule: {
  active?: boolean;
  valid_until?: string | null;
}): Promise<{ tourId: string; scheduleId: string }> {
  const { data: tour, error } = await db
    .from('tours')
    .insert({
      slug: `withdraw-${crypto.randomUUID()}`,
      name_es: 'Retiro ES',
      name_en: 'Withdraw EN',
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
  if (error) throw new Error(error.message);
  tourIds.push(tour.id);
  const { data: row, error: scheduleError } = await db
    .from('tour_schedules')
    .insert({
      tour_id: tour.id,
      day_of_week: 1,
      start_time: '09:00:00',
      capacity: 10,
      active: schedule.active ?? true,
      valid_from: '2026-01-01',
      valid_until: schedule.valid_until ?? null,
    })
    .select('id')
    .single();
  if (scheduleError) throw new Error(scheduleError.message);
  return { tourId: tour.id, scheduleId: row.id };
}

async function instance(tourId: string, scheduleId: string, startsAtMs: number): Promise<string> {
  const { data, error } = await db
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: new Date(startsAtMs).toISOString(),
      ends_at: new Date(startsAtMs + HOUR_MS).toISOString(),
      capacity_total: 10,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function withdraw(tourId: string, actorId = adminId) {
  return db.rpc('withdraw_schedule_instances', { p_tour_id: tourId, p_actor_id: actorId });
}

async function statusOf(instanceId: string) {
  const { data } = await db
    .from('tour_instances')
    .select('status, cancellation_reason')
    .eq('id', instanceId)
    .single();
  return data;
}

async function booking(instanceId: string, status: 'confirmed' | 'cancelled'): Promise<void> {
  const { error } = await db.from('bookings').insert({
    tour_instance_id: instanceId,
    customer_name: 'C',
    customer_email: 'c@example.com',
    tickets_adult: 1,
    total_amount_cents: 5000,
    status,
  });
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  const { data: admin } = await db.from('users').select('id').eq('role', 'admin').limit(1).single();
  const { data: staff } = await db.from('users').select('id').eq('role', 'staff').limit(1).single();
  adminId = admin!.id;
  staffId = staff!.id;
});

afterEach(async () => {
  await deleteToursDeep(db, tourIds.splice(0));
});

describe('withdraw_schedule_instances', () => {
  it('withdraws the future departures of an inactive schedule', async () => {
    // Arrange
    const { tourId, scheduleId } = await tourWithSchedule({ active: false });
    const id = await instance(tourId, scheduleId, Date.now() + 3 * DAY_MS);

    // Act
    const { data } = await withdraw(tourId);

    // Assert
    expect(data).toEqual({ withdrawn: 1, kept: 0 });
    expect(await statusOf(id)).toEqual({
      status: 'cancelled',
      cancellation_reason: 'schedule_withdrawn',
    });
  });

  it('withdraws only the departures outside the validity window', async () => {
    // Arrange
    const insideMs = Date.now() + 3 * DAY_MS;
    const { tourId, scheduleId } = await tourWithSchedule({ valid_until: crDay(insideMs) });
    const inside = await instance(tourId, scheduleId, insideMs);
    const outside = await instance(tourId, scheduleId, insideMs + 7 * DAY_MS);

    // Act
    const { data } = await withdraw(tourId);

    // Assert
    expect(data).toEqual({ withdrawn: 1, kept: 0 });
    expect((await statusOf(inside))?.status).toBe('available');
    expect((await statusOf(outside))?.status).toBe('cancelled');
  });

  // 23:30 en Costa Rica ya es el día siguiente en UTC: el día que cuenta es el de Costa Rica.
  it('counts the day in Costa Rica time', async () => {
    // Arrange
    const day = crDay(Date.now() + 3 * DAY_MS);
    const lateNightMs = new Date(`${day}T23:30:00-06:00`).getTime();
    const { tourId, scheduleId } = await tourWithSchedule({ valid_until: day });
    const id = await instance(tourId, scheduleId, lateNightMs);

    // Act
    const { data } = await withdraw(tourId);

    // Assert
    expect(data).toEqual({ withdrawn: 0, kept: 0 });
    expect((await statusOf(id))?.status).toBe('available');
  });

  it('keeps a departure with a live booking and counts it', async () => {
    // Arrange
    const { tourId, scheduleId } = await tourWithSchedule({ active: false });
    const id = await instance(tourId, scheduleId, Date.now() + 3 * DAY_MS);
    await booking(id, 'confirmed');

    // Act
    const { data } = await withdraw(tourId);

    // Assert
    expect(data).toEqual({ withdrawn: 0, kept: 1 });
    expect((await statusOf(id))?.status).toBe('available');
  });

  it('withdraws a departure whose only booking was cancelled', async () => {
    // Arrange
    const { tourId, scheduleId } = await tourWithSchedule({ active: false });
    const id = await instance(tourId, scheduleId, Date.now() + 3 * DAY_MS);
    await booking(id, 'cancelled');

    // Act
    const { data } = await withdraw(tourId);

    // Assert
    expect(data).toEqual({ withdrawn: 1, kept: 0 });
  });

  it('keeps a departure with a live hold, and withdraws one whose hold expired', async () => {
    // Arrange
    const { tourId, scheduleId } = await tourWithSchedule({ active: false });
    const live = await instance(tourId, scheduleId, Date.now() + 3 * DAY_MS);
    const expired = await instance(tourId, scheduleId, Date.now() + 10 * DAY_MS);
    const { error } = await db.from('tour_holds').insert([
      {
        tour_instance_id: live,
        session_token: crypto.randomUUID(),
        held_seats: 1,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      },
      {
        tour_instance_id: expired,
        session_token: crypto.randomUUID(),
        held_seats: 1,
        expires_at: new Date(Date.now() - 600_000).toISOString(),
      },
    ]);
    if (error) throw new Error(error.message);

    // Act
    const { data } = await withdraw(tourId);

    // Assert
    expect(data).toEqual({ withdrawn: 1, kept: 1 });
    expect((await statusOf(live))?.status).toBe('available');
    expect((await statusOf(expired))?.status).toBe('cancelled');
  });

  // El motor del cobro diferido no mira salidas canceladas: una retención viva quedaría sin dueño.
  it('keeps a departure with an open charge cycle', async () => {
    // Arrange
    const { tourId, scheduleId } = await tourWithSchedule({ active: false });
    const id = await instance(tourId, scheduleId, Date.now() + 3 * DAY_MS);
    const { error } = await db
      .from('tour_instances')
      .update({
        minimum_charge_triggered_at: new Date().toISOString(),
        min_participants_at_trigger: 1,
        seats_at_trigger: 0,
        staff_decision_required_at: new Date(Date.now() + DAY_MS).toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(error.message);

    // Act
    const { data } = await withdraw(tourId);

    // Assert
    expect(data).toEqual({ withdrawn: 0, kept: 1 });
  });

  it('is idempotent', async () => {
    // Arrange
    const { tourId, scheduleId } = await tourWithSchedule({ active: false });
    await instance(tourId, scheduleId, Date.now() + 3 * DAY_MS);
    await withdraw(tourId);

    // Act
    const { data } = await withdraw(tourId);

    // Assert
    expect(data).toEqual({ withdrawn: 0, kept: 0 });
  });

  it('rejects an actor that is not an admin', async () => {
    // Arrange
    const { tourId, scheduleId } = await tourWithSchedule({ active: false });
    await instance(tourId, scheduleId, Date.now() + 3 * DAY_MS);

    // Act
    const { error } = await withdraw(tourId, staffId);

    // Assert
    expect(error?.message).toContain('INVALID_ACTOR');
  });
});
