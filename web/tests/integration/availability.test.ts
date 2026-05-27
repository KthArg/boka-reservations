// Motor de disponibilidad y holds — tests de integración
// Requiere: supabase start (Docker Desktop)
// Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Database } from '@/types/database';
import { checkAvailability, createHold, releaseHold } from '@/lib/booking/availability';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TEST_SLUG = 'integration-availability-test';
let tourId: string;
let scheduleId: string;
let instanceId: string;

function futureTimestamp(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

beforeAll(async () => {
  await admin.from('tours').delete().eq('slug', TEST_SLUG);

  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'Tour disponibilidad test',
      name_en: 'Availability test tour',
      description_es: 'Desc',
      description_en: 'Desc',
      difficulty: 'easy',
      duration_minutes: 90,
      meeting_point_es: 'Entrada',
      meeting_point_en: 'Entrance',
      includes_es: 'Guía',
      includes_en: 'Guide',
      min_participants: 1,
      max_capacity: 10,
      status: 'active',
    })
    .select('id')
    .single();

  tourId = tour!.id;

  const { data: schedule } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 1, start_time: '08:00', capacity: 10 })
    .select('id')
    .single();

  scheduleId = schedule!.id;

  const startsAt = futureTimestamp(7 * 24 * 60 * 60 * 1000);
  const endsAt = futureTimestamp(7 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000);

  const { data: instance } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: startsAt,
      ends_at: endsAt,
      capacity_total: 5,
      capacity_reserved: 0,
      status: 'available',
    })
    .select('id')
    .single();

  instanceId = instance!.id;
});

afterAll(async () => {
  await admin.from('tours').delete().eq('id', tourId);
});

describe('checkAvailability', () => {
  it('retorna capacity_total cuando no hay holds ni reservas', async () => {
    const result = await checkAvailability(instanceId, 1);
    expect(result.available).toBe(5);
    expect(result.canBook).toBe(true);
  });

  it('retorna 0 para instancia inexistente', async () => {
    const result = await checkAvailability('00000000-0000-0000-0000-000000000000', 1);
    expect(result.available).toBe(0);
    expect(result.canBook).toBe(false);
  });

  it('retorna 0 para instancia pasada', async () => {
    const pastStarts = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const pastEnds = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: past } = await admin
      .from('tour_instances')
      .insert({
        tour_id: tourId,
        schedule_id: scheduleId,
        starts_at: pastStarts,
        ends_at: pastEnds,
        capacity_total: 5,
        status: 'available',
      })
      .select('id')
      .single();

    const result = await checkAvailability(past!.id, 1);
    expect(result.available).toBe(0);
    expect(result.canBook).toBe(false);

    await admin.from('tour_instances').delete().eq('id', past!.id);
  });

  it('descuenta holds activos del total disponible', async () => {
    await admin.from('tour_holds').insert({
      tour_instance_id: instanceId,
      session_token: 'check-test-session',
      held_seats: 2,
      status: 'active',
      expires_at: futureTimestamp(15 * 60 * 1000),
    });

    const result = await checkAvailability(instanceId, 1);
    expect(result.available).toBe(3);

    await admin.from('tour_holds').delete().eq('session_token', 'check-test-session');
  });

  it('ignora holds expirados', async () => {
    await admin.from('tour_holds').insert({
      tour_instance_id: instanceId,
      session_token: 'expired-session',
      held_seats: 3,
      status: 'active',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const result = await checkAvailability(instanceId, 1);
    expect(result.available).toBe(5);

    await admin.from('tour_holds').delete().eq('session_token', 'expired-session');
  });
});

describe('createHold / releaseHold', () => {
  it('crea un hold y retorna holdId + expiresAt', async () => {
    const result = await createHold(instanceId, 2, 'session-create-test');
    expect(result.holdId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

    await admin.from('tour_holds').delete().eq('id', result.holdId);
  });

  it('es idempotente — mismo session_token devuelve el hold existente', async () => {
    const r1 = await createHold(instanceId, 1, 'session-idempotent');
    const r2 = await createHold(instanceId, 1, 'session-idempotent');
    expect(r1.holdId).toBe(r2.holdId);

    await admin.from('tour_holds').delete().eq('id', r1.holdId);
  });

  it('falla con error cuando no hay cupos suficientes', async () => {
    // Ocupar toda la capacidad (5 cupos)
    await admin.from('tour_holds').insert({
      tour_instance_id: instanceId,
      session_token: 'full-session',
      held_seats: 5,
      status: 'active',
      expires_at: futureTimestamp(15 * 60 * 1000),
    });

    await expect(createHold(instanceId, 1, 'should-fail')).rejects.toThrow('HOLD_NO_CAPACITY');

    await admin.from('tour_holds').delete().eq('session_token', 'full-session');
  });

  it('releaseHold pasa el hold a estado released', async () => {
    const { holdId } = await createHold(instanceId, 1, 'session-release-test');
    await releaseHold(holdId);

    const { data } = await admin.from('tour_holds').select('status').eq('id', holdId).single();
    expect(data?.status).toBe('released');

    await admin.from('tour_holds').delete().eq('id', holdId);
  });

  it('checkAvailability refleja el hold activo correctamente', async () => {
    const { holdId } = await createHold(instanceId, 3, 'session-check-after-hold');

    const result = await checkAvailability(instanceId, 1);
    expect(result.available).toBe(2);
    expect(result.canBook).toBe(true);

    const result2 = await checkAvailability(instanceId, 3);
    expect(result2.canBook).toBe(false);

    await admin.from('tour_holds').delete().eq('id', holdId);
  });
});
