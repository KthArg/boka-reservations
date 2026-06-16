import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { deleteToursDeep } from './cleanup';

// listUpcomingDepartures / listGuides usan createSupabaseServerClient
// (next/headers, server-only). Mockeamos esas fronteras y devolvemos el service
// client real para ejercitar la query (embedding incluido) contra Postgres. Este
// test existe para cubrir el embed de tour_instance_guides→users, que tiene DOS
// FKs (guide_id y assigned_by) y fallaba en runtime sin hint de desambiguación.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }),
}));

const { listUpcomingDepartures, listGuides } = await import('@/lib/guides/repository');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DAY_MS = 86_400_000;

let admin: SupabaseClient;
let guideId: string;
let staffId: string;
const createdTourIds: string[] = [];

async function seedInstance(startsAt: string): Promise<string> {
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: `dep-${crypto.randomUUID()}`,
      name_es: 'Salida ES',
      name_en: 'Departure EN',
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
    .insert({ tour_id: tour!.id, day_of_week: 1, start_time: '09:00:00', capacity: 10 })
    .select('id')
    .single();

  const { data: instance } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tour!.id,
      schedule_id: schedule!.id,
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(),
      capacity_total: 10,
    })
    .select('id')
    .single();

  return instance!.id;
}

describe('listUpcomingDepartures / listGuides (integration)', () => {
  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: staff } = await admin
      .from('users')
      .select('id')
      .eq('role', 'staff')
      .limit(1)
      .single();
    staffId = staff!.id;
    const { data: guide } = await admin
      .from('users')
      .insert({
        email: `dep-guide-${crypto.randomUUID()}@example.com`,
        role: 'guide',
        full_name: 'Guía Salidas',
        phone: '+506 8000-0003',
      })
      .select('id')
      .single();
    guideId = guide!.id;
  });

  afterEach(async () => {
    // Antes (spec 0026, ítem 3): borraba solo el tour → los FKs de schedule/instances/bookings/
    // tour_instance_guides hacían fallar el delete en silencio y la suite filtraba "Salida ES".
    await deleteToursDeep(admin, createdTourIds.splice(0));
  });

  afterAll(async () => {
    await admin.from('users').delete().eq('id', guideId);
  });

  it('embebe el guía asignado (FK guide_id) y cuenta tiquetes confirmados', async () => {
    const startsAt = new Date(Date.now() + 2 * DAY_MS).toISOString();
    const instanceId = await seedInstance(startsAt);
    // assigned_by != guide_id ejercita ambas FKs de la tabla puente a users.
    await admin.from('tour_instance_guides').insert({
      tour_instance_id: instanceId,
      guide_id: guideId,
      assigned_by: staffId,
    });
    await admin.from('bookings').insert({
      tour_instance_id: instanceId,
      customer_name: 'C',
      customer_email: 'c@example.com',
      tickets_adult: 2,
      tickets_child: 1,
      total_amount_cents: 5000,
      status: 'confirmed',
    });

    const departures = await listUpcomingDepartures();
    const dep = departures.find((d) => d.id === instanceId);

    expect(dep).toBeDefined();
    expect(dep!.assignedGuide).toEqual({ id: guideId, fullName: 'Guía Salidas' });
    expect(dep!.confirmedTickets).toBe(3);
  });

  it('deja assignedGuide en null cuando la salida no tiene guía', async () => {
    const startsAt = new Date(Date.now() + 2 * DAY_MS).toISOString();
    const instanceId = await seedInstance(startsAt);

    const departures = await listUpcomingDepartures();
    const dep = departures.find((d) => d.id === instanceId);

    expect(dep).toBeDefined();
    expect(dep!.assignedGuide).toBeNull();
  });

  it('listGuides incluye al guía sembrado', async () => {
    const guides = await listGuides();
    expect(guides.some((g) => g.id === guideId && g.fullName === 'Guía Salidas')).toBe(true);
  });
});
