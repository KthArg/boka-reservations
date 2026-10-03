// updateTour retira las salidas fuera de vigencia al guardar (spec 0044), y con salidas que no pudo
// retirar devuelve los conteos en vez de redirigir. Sesión de admin real; se mockean solo las
// fronteras de Next que no existen en vitest (requireRole, cliente de sesión, redirect, locale).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTour, updateTour } from '@/lib/tours/actions';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';

const requireRoleMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/auth/server', () => ({ requireRole: requireRoleMock }));
vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'es' }));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const DAY_MS = 86_400_000;

const service = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let adminSession: SupabaseClient<Database>;
const createdTourIds: string[] = [];

type ScheduleJson = {
  id?: string;
  day_of_week: number;
  start_time: string;
  capacity: number;
  active: boolean;
};

function tourForm(slug: string, schedules: ScheduleJson[]): FormData {
  const fields: Record<string, string> = {
    slug,
    name_es: 'Tour vigencia',
    name_en: 'Validity tour',
    description_es: 'd',
    description_en: 'd',
    difficulty: 'easy',
    duration_minutes: '60',
    meeting_point_es: 'P',
    meeting_point_en: 'P',
    includes_es: 'g',
    includes_en: 'g',
    excludes_es: 'x',
    excludes_en: 'x',
    requirements_es: 'r',
    requirements_en: 'r',
    min_participants: '1',
    max_capacity: '10',
    cover_image_url: '',
    pricing: '[]',
    schedules: JSON.stringify(schedules),
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

async function instance(tourId: string, scheduleId: string, startsAtMs: number): Promise<string> {
  const { data, error } = await service
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: new Date(startsAtMs).toISOString(),
      ends_at: new Date(startsAtMs + 3_600_000).toISOString(),
      capacity_total: 10,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

beforeAll(async () => {
  adminSession = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await adminSession.auth.signInWithPassword({
    email: 'admin@bokatrails.com',
    password: 'admin1234',
  });
  if (error) throw new Error(`signIn admin: ${error.message}`);
  session.client = adminSession;
  requireRoleMock.mockResolvedValue({ id: data.user.id });
});

afterAll(async () => {
  await deleteToursDeep(service, [...new Set(createdTourIds)]);
});

describe('updateTour — retiro de salidas fuera de vigencia', () => {
  it('withdraws the free departures of a deactivated schedule and reports the ones it kept', async () => {
    // Arrange
    const slug = `vigencia-${crypto.randomUUID().slice(0, 8)}`;
    const schedule = { day_of_week: 1, start_time: '08:00', capacity: 10, active: true };
    await createTour(null, tourForm(slug, [schedule]));
    const { data: tour } = await service.from('tours').select('id').eq('slug', slug).single();
    createdTourIds.push(tour!.id);
    const { data: saved } = await service
      .from('tour_schedules')
      .select('id')
      .eq('tour_id', tour!.id)
      .single();
    const free = await instance(tour!.id, saved!.id, Date.now() + 3 * DAY_MS);
    const booked = await instance(tour!.id, saved!.id, Date.now() + 10 * DAY_MS);
    await service.from('bookings').insert({
      tour_instance_id: booked,
      customer_name: 'C',
      customer_email: 'c@example.com',
      tickets_adult: 1,
      total_amount_cents: 5000,
      status: 'confirmed',
    });
    redirectMock.mockClear();

    // Act
    const result = await updateTour(
      tour!.id,
      null,
      tourForm(slug, [{ ...schedule, id: saved!.id, active: false }]),
    );

    // Assert
    expect(result).toEqual({ success: true, id: tour!.id, withdrawn: 1, kept: 1 });
    expect(redirectMock).not.toHaveBeenCalled();
    const { data: rows } = await service
      .from('tour_instances')
      .select('id, status')
      .in('id', [free, booked]);
    const status = Object.fromEntries((rows ?? []).map((r) => [r.id, r.status]));
    expect(status[free]).toBe('cancelled');
    expect(status[booked]).toBe('available');
  });
});
