// Turno día/noche de un tour (spec 0042 §5.3): getTourShift lee los horarios con el cliente anon.
// Cuentan los horarios activos (la RLS anon solo deja ver esos) y sin vencer; valid_until = hoy
// todavía cuenta.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { crDate } from '@/lib/dates/cr-date';
import { getTourShift } from '@/lib/public/tours';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const DAY_MS = 86_400_000;

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let tourId: string;

type ScheduleInput = { start_time: string; active?: boolean; valid_until?: string | null };

async function schedules(rows: ScheduleInput[]) {
  const { error } = await admin.from('tour_schedules').insert(
    rows.map((row, i) => ({
      tour_id: tourId,
      day_of_week: i % 7,
      capacity: 10,
      valid_from: '2026-01-01',
      // En un insert de varias filas PostgREST pone null en las columnas que faltan en alguna fila.
      active: true,
      valid_until: null,
      ...row,
    })),
  );
  if (error) throw new Error(`schedules: ${error.message}`);
}

beforeAll(async () => {
  const { data, error } = await admin
    .from('tours')
    .insert({
      slug: `shift-${crypto.randomUUID().slice(0, 8)}`,
      name_es: 'Turno',
      name_en: 'Shift',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'P',
      meeting_point_en: 'P',
      includes_es: 'g',
      includes_en: 'g',
      min_participants: 1,
      max_capacity: 10,
    })
    .select('id')
    .single();
  if (error) throw new Error(`tour: ${error.message}`);
  tourId = data.id;
});

afterEach(async () => {
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
});

afterAll(async () => {
  await admin.from('tours').delete().eq('id', tourId);
});

describe('getTourShift (spec 0042)', () => {
  it('sin horarios no hay turno', async () => {
    expect(await getTourShift(tourId)).toBeNull();
  });

  it('un horario de las 17:30 hace el tour de noche', async () => {
    await schedules([{ start_time: '17:30' }]);
    expect(await getTourShift(tourId)).toBe('night');
  });

  it('horarios de mañana y de noche dan día y noche', async () => {
    await schedules([{ start_time: '08:00' }, { start_time: '19:00' }]);
    expect(await getTourShift(tourId)).toBe('both');
  });

  it('un horario inactivo no cuenta', async () => {
    await schedules([{ start_time: '08:00' }, { start_time: '19:00', active: false }]);
    expect(await getTourShift(tourId)).toBe('day');
  });

  it('un horario vencido no cuenta; uno que vence hoy sí', async () => {
    const yesterday = crDate(new Date(Date.now() - DAY_MS));
    await schedules([
      { start_time: '08:00', valid_until: crDate() },
      { start_time: '19:00', valid_until: yesterday },
    ]);
    expect(await getTourShift(tourId)).toBe('day');
  });
});
