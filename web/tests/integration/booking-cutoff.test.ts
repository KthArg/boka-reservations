// Anticipación mínima para reservar (spec 0041, migración …054): create_hold_atomic cierra la venta
// booking_cutoff_hours antes de la salida, y el calendario no muestra las salidas cerradas. Usa el
// valor por defecto (3 h); el caso de 0 h cambia el valor global y lo restaura (los archivos de
// integración corren de a uno, fileParallelism: false).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUSINESS_SETTINGS_ID } from '@shared/constants/settings';
import { getUpcomingInstances, isClosedForOnlineBooking } from '@/lib/public/tours';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let tourId: string;
let scheduleId: string;
let originalCutoff: number;

async function departure(offsetMs: number, status: 'available' | 'cancelled' = 'available') {
  const startsAt = new Date(Date.now() + offsetMs).toISOString();
  const { data, error } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: startsAt,
      ends_at: startsAt,
      capacity_total: 10,
      status,
    })
    .select('id')
    .single();
  if (error) throw new Error(`departure: ${error.message}`);
  return data.id;
}

function hold(instanceId: string) {
  return admin.rpc('create_hold_atomic', {
    p_instance_id: instanceId,
    p_seats: 1,
    p_session: `cutoff-${crypto.randomUUID()}`,
  });
}

async function setCutoff(hours: number) {
  const { error } = await admin
    .from('business_settings')
    .update({ booking_cutoff_hours: hours })
    .eq('id', BUSINESS_SETTINGS_ID);
  if (error) throw new Error(`setCutoff: ${error.message}`);
}

beforeAll(async () => {
  const { data: tour, error } = await admin
    .from('tours')
    .insert({
      slug: `cutoff-${crypto.randomUUID().slice(0, 8)}`,
      name_es: 'Corte',
      name_en: 'Cutoff',
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
  tourId = tour.id;
  const { data: schedule } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 1, start_time: '08:00', capacity: 10 })
    .select('id')
    .single();
  scheduleId = schedule!.id;
  const { data: settings } = await admin
    .from('business_settings')
    .select('booking_cutoff_hours')
    .eq('id', BUSINESS_SETTINGS_ID)
    .single();
  originalCutoff = settings!.booking_cutoff_hours;
  await setCutoff(3);
});

afterAll(async () => {
  await setCutoff(originalCutoff);
  await admin
    .from('tour_holds')
    .delete()
    .in(
      'tour_instance_id',
      ((await admin.from('tour_instances').select('id').eq('tour_id', tourId)).data ?? []).map(
        (r) => r.id,
      ),
    );
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
});

describe('create_hold_atomic con anticipación mínima de 3 horas (spec 0041)', () => {
  it('rechaza una salida que empieza dentro del plazo', async () => {
    const { error } = await hold(await departure(3 * HOUR_MS - MINUTE_MS));
    expect(error?.message).toContain('HOLD_BOOKING_CLOSED');
  });

  it('acepta una salida fuera del plazo', async () => {
    const { error } = await hold(await departure(3 * HOUR_MS + 5 * MINUTE_MS));
    expect(error).toBeNull();
  });

  it('una salida cancelada dentro del plazo sigue dando HOLD_INSTANCE_UNAVAILABLE', async () => {
    const { error } = await hold(await departure(HOUR_MS, 'cancelled'));
    expect(error?.message).toContain('HOLD_INSTANCE_UNAVAILABLE');
  });

  it('una salida que ya empezó sigue dando HOLD_INSTANCE_PAST', async () => {
    const { error } = await hold(await departure(-MINUTE_MS));
    expect(error?.message).toContain('HOLD_INSTANCE_PAST');
  });

  it('el aviso de venta cerrada es solo para una disponible dentro del plazo', async () => {
    expect(await isClosedForOnlineBooking(tourId, await departure(HOUR_MS), 3)).toBe(true);
    expect(await isClosedForOnlineBooking(tourId, await departure(5 * HOUR_MS), 3)).toBe(false);
    expect(await isClosedForOnlineBooking(tourId, await departure(HOUR_MS, 'cancelled'), 3)).toBe(
      false,
    );
    expect(await isClosedForOnlineBooking(tourId, await departure(-HOUR_MS), 3)).toBe(false);
    expect(await isClosedForOnlineBooking(crypto.randomUUID(), await departure(HOUR_MS), 3)).toBe(
      false,
    );
  });

  it('el calendario no muestra las salidas dentro del plazo', async () => {
    const inside = await departure(2 * HOUR_MS);
    const outside = await departure(5 * HOUR_MS);
    const ids = (await getUpcomingInstances(tourId, 3)).map((i) => i.id);
    expect(ids).toContain(outside);
    expect(ids).not.toContain(inside);
  });
});

describe('anticipación mínima en 0 (spec 0041)', () => {
  it('acepta una salida que empieza en minutos', async () => {
    await setCutoff(0);
    try {
      const { error } = await hold(await departure(10 * MINUTE_MS));
      expect(error).toBeNull();
    } finally {
      await setCutoff(3);
    }
  });
});

describe('booking_cutoff_hours: permisos y rango (spec 0041)', () => {
  let adminSession: SupabaseClient<Database>;
  let staffSession: SupabaseClient<Database>;
  let adminId: string;

  beforeAll(async () => {
    const signIn = async (email: string, password: string) => {
      const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`signIn ${email}: ${error.message}`);
      return client;
    };
    [adminSession, staffSession] = await Promise.all([
      signIn('admin@bokatrails.com', 'admin1234'),
      signIn('staff@bokatrails.com', 'staff1234'),
    ]);
    const { data } = await admin
      .from('users')
      .select('id')
      .eq('email', 'admin@bokatrails.com')
      .single();
    adminId = data!.id;
  });

  afterAll(async () => {
    await Promise.all([
      adminSession.auth.signOut({ scope: 'local' }),
      staffSession.auth.signOut({ scope: 'local' }),
    ]);
  });

  it('el admin lo cambia; staff no', async () => {
    try {
      const byAdmin = await adminSession
        .from('business_settings')
        .update({ booking_cutoff_hours: 6, updated_by: adminId })
        .eq('id', BUSINESS_SETTINGS_ID)
        .select('booking_cutoff_hours');
      expect(byAdmin.error).toBeNull();
      expect(byAdmin.data).toEqual([{ booking_cutoff_hours: 6 }]);

      const byStaff = await staffSession
        .from('business_settings')
        .update({ booking_cutoff_hours: 1 })
        .eq('id', BUSINESS_SETTINGS_ID)
        .select('booking_cutoff_hours');
      expect(byStaff.data ?? []).toHaveLength(0);
    } finally {
      await setCutoff(3);
    }
  });

  it('fuera de rango lo rechaza el CHECK', async () => {
    const { error } = await admin
      .from('business_settings')
      .update({ booking_cutoff_hours: 73 })
      .eq('id', BUSINESS_SETTINGS_ID);
    expect(error?.code).toBe('23514');
  });
});
