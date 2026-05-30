import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Mismo select que usa lib/booking/repository.ts. La función del repo no se
// puede importar aquí porque depende de next/headers (server-only); replicamos
// el select para validar que el embedding de PostgREST resuelve como esperamos.
const LIST_SELECT = `
  id, customer_name, status, checked_in_at,
  tickets_adult, tickets_child, tickets_student,
  tour_instances!inner ( starts_at, tour_id, tours!inner ( name_es ) ),
  payments ( status )
`;

let admin: SupabaseClient;
const createdTourIds: string[] = [];

async function seedConfirmedBooking(customerName = 'Ana Pérez'): Promise<{
  tourId: string;
  bookingId: string;
}> {
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: `t-${crypto.randomUUID()}`,
      name_es: 'Tour Volcán',
      name_en: 'Volcano Tour',
      description_es: 'desc',
      description_en: 'desc',
      difficulty: 'easy',
      duration_minutes: 120,
      meeting_point_es: 'mp',
      meeting_point_en: 'mp',
      includes_es: 'inc',
      includes_en: 'inc',
      min_participants: 1,
      max_capacity: 20,
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
      capacity: 20,
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
      capacity_total: 20,
      capacity_reserved: 3,
    })
    .select('id')
    .single();

  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instance!.id,
      customer_name: customerName,
      customer_email: 'ana@example.com',
      tickets_adult: 2,
      tickets_child: 1,
      total_amount_cents: 12500,
      status: 'confirmed',
    })
    .select('id')
    .single();

  return { tourId: tour!.id, bookingId: booking!.id };
}

describe('panel de reservas + check-in (integration)', () => {
  beforeAll(() => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterEach(async () => {
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

  it('el embedding del listado resuelve nombre del tour y permite filtrar por tour', async () => {
    const { tourId, bookingId } = await seedConfirmedBooking();

    const { data, error } = await admin
      .from('bookings')
      .select(LIST_SELECT)
      .eq('tour_instances.tour_id', tourId);

    expect(error).toBeNull();
    const rows = data as unknown as Array<{
      id: string;
      tour_instances: { tours: { name_es: string } };
    }>;
    const row = rows.find((r) => r.id === bookingId);
    expect(row).toBeDefined();
    expect(row!.tour_instances.tours.name_es).toBe('Tour Volcán');
  });

  it('marcar check-in es idempotente: no pisa el timestamp original', async () => {
    const { bookingId } = await seedConfirmedBooking();
    const first = new Date('2026-05-30T15:00:00.000Z').toISOString();

    await admin
      .from('bookings')
      .update({ checked_in_at: first })
      .eq('id', bookingId)
      .is('checked_in_at', null);

    await admin
      .from('bookings')
      .update({ checked_in_at: new Date('2026-05-30T16:00:00.000Z').toISOString() })
      .eq('id', bookingId)
      .is('checked_in_at', null);

    const { data } = await admin
      .from('bookings')
      .select('checked_in_at')
      .eq('id', bookingId)
      .single();
    expect(data!.checked_in_at).toBe(first);
  });

  it('revertir el check-in deja los campos en null', async () => {
    const { bookingId } = await seedConfirmedBooking();
    await admin
      .from('bookings')
      .update({ checked_in_at: new Date().toISOString() })
      .eq('id', bookingId);

    await admin
      .from('bookings')
      .update({ checked_in_at: null, checked_in_by: null })
      .eq('id', bookingId);

    const { data } = await admin
      .from('bookings')
      .select('checked_in_at, checked_in_by')
      .eq('id', bookingId)
      .single();
    expect(data!.checked_in_at).toBeNull();
    expect(data!.checked_in_by).toBeNull();
  });

  it('anon no puede leer bookings (RLS)', async () => {
    await seedConfirmedBooking();
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data } = await anon.from('bookings').select('id');
    expect(data ?? []).toEqual([]);
  });
});
