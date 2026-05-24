// Portal público — RLS anon + generación de instancias.
// Requiere: supabase start (Docker Desktop)
// Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7w9IC0uf2qUT5aY2pUFdqZfx76kmARUL';

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
const anon = createClient<Database>(SUPABASE_URL, ANON_KEY);

const TEST_SLUG = 'integration-portal-test';
let tourId: string;
let scheduleId: string;

beforeAll(async () => {
  await admin.from('tours').delete().eq('slug', TEST_SLUG);

  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'Tour portal test',
      name_en: 'Portal test tour',
      description_es: 'Desc ES',
      description_en: 'Desc EN',
      difficulty: 'easy',
      duration_minutes: 90,
      meeting_point_es: 'Entrada',
      meeting_point_en: 'Entrance',
      includes_es: 'Guía',
      includes_en: 'Guide',
      min_participants: 1,
      max_capacity: 8,
      status: 'active',
    })
    .select('id')
    .single();

  tourId = tour!.id;

  const { data: schedule } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 5, start_time: '07:00', capacity: 8 })
    .select('id')
    .single();

  scheduleId = schedule!.id;
});

afterAll(async () => {
  await admin.from('tours').delete().eq('id', tourId);
});

describe('anon RLS — tours', () => {
  it('anon puede leer tours activos', async () => {
    const { data, error } = await anon.from('tours').select('id').eq('slug', TEST_SLUG);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('anon no puede insertar tours', async () => {
    const { error } = await anon.from('tours').insert({
      slug: 'anon-hack',
      name_es: 'x',
      name_en: 'x',
      description_es: 'x',
      description_en: 'x',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'x',
      meeting_point_en: 'x',
      includes_es: 'x',
      includes_en: 'x',
      min_participants: 1,
      max_capacity: 5,
    });
    expect(error).not.toBeNull();
  });
});

describe('anon RLS — tour_instances', () => {
  it('anon puede leer instancias disponibles y futuras', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const endsDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000).toISOString();

    await admin.from('tour_instances').insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: futureDate,
      ends_at: endsDate,
      capacity_total: 8,
      status: 'available',
    });

    const { data, error } = await anon
      .from('tour_instances')
      .select('id')
      .eq('tour_id', tourId)
      .eq('status', 'available');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it('anon no puede insertar instancias', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const endsDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000).toISOString();

    const { error } = await anon.from('tour_instances').insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: futureDate,
      ends_at: endsDate,
      capacity_total: 8,
    });

    expect(error).not.toBeNull();
  });
});

describe('tour_instances — idempotencia del upsert', () => {
  it('insertar la misma instancia dos veces no duplica la fila', async () => {
    const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000).toISOString();
    const row = {
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: startsAt,
      ends_at: endsAt,
      capacity_total: 8,
    };

    await admin
      .from('tour_instances')
      .upsert(row, { onConflict: 'schedule_id,starts_at', ignoreDuplicates: true });
    await admin
      .from('tour_instances')
      .upsert(row, { onConflict: 'schedule_id,starts_at', ignoreDuplicates: true });

    const { data } = await admin
      .from('tour_instances')
      .select('id')
      .eq('schedule_id', scheduleId)
      .eq('starts_at', startsAt);

    expect(data).toHaveLength(1);
  });
});
