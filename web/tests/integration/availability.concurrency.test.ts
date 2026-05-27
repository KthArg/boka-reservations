// Tests de concurrencia — createHold bajo requests simultáneos
// Requiere: supabase start (Docker Desktop)
// Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Database } from '@/types/database';
import { createHold } from '@/lib/booking/availability';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const TEST_SLUG = 'integration-concurrency-test';
let tourId: string;
let scheduleId: string;

function futureTimestamp(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function createInstance(capacity: number) {
  const startsAt = futureTimestamp(7 * 24 * 60 * 60 * 1000 + Math.random() * 1_000_000);
  const endsAt = new Date(new Date(startsAt).getTime() + 90 * 60 * 1000).toISOString();

  const { data } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: startsAt,
      ends_at: endsAt,
      capacity_total: capacity,
      capacity_reserved: 0,
      status: 'available',
    })
    .select('id')
    .single();

  return data!.id;
}

beforeAll(async () => {
  await admin.from('tours').delete().eq('slug', TEST_SLUG);

  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'Tour concurrencia test',
      name_en: 'Concurrency test tour',
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
    .insert({ tour_id: tourId, day_of_week: 2, start_time: '09:00', capacity: 10 })
    .select('id')
    .single();

  scheduleId = schedule!.id;
});

afterAll(async () => {
  await admin.from('tours').delete().eq('id', tourId);
});

describe('createHold — concurrencia', () => {
  it('10 requests simultáneos sobre capacidad 5 — exactamente 5 ganan', async () => {
    const instanceId = await createInstance(5);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => createHold(instanceId, 1, `concurrent-session-${i}`)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(5);
    rejected.forEach((r) => {
      expect((r as PromiseRejectedResult).reason.message).toContain('HOLD_NO_CAPACITY');
    });

    await admin.from('tour_instances').delete().eq('id', instanceId);
  });

  it('2 requests simultáneos para el último cupo — exactamente 1 gana', async () => {
    const instanceId = await createInstance(1);

    const results = await Promise.allSettled([
      createHold(instanceId, 1, 'race-session-A'),
      createHold(instanceId, 1, 'race-session-B'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    await admin.from('tour_instances').delete().eq('id', instanceId);
  });
});
