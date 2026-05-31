import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// listBookingsForAdmin / listBookingsForExport usan createSupabaseServerClient
// (next/headers, server-only), que no existe en vitest. Mockeamos esas fronteras
// y devolvemos el service client real: así el test ejercita la construcción de
// la query (eq/order/range + embedding) contra Postgres de verdad. Este test
// existe específicamente para cubrir esa ruta: antes no se ejecutaba y un bug de
// "q.order is not a function" (builder thenable desenvuelto por async) llegó a
// runtime sin que ningún test lo atrapara.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/supabase-server', () => ({
  // Service client autocontenido (no cierra sobre variables del test, que el
  // hoisting de vi.mock no garantiza inicializadas). Bypassa RLS, suficiente
  // para validar la construcción de la query.
  createSupabaseServerClient: vi.fn(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }),
}));

const { listBookingsForAdmin } = await import('@/lib/booking/repository');
const { listBookingsForExport } = await import('@/lib/booking/export-repository');
const { parseBookingFilters } = await import('@/lib/booking/admin-filters');

let admin: SupabaseClient;
const createdTourIds: string[] = [];

async function seedConfirmedBooking(customerName = 'Repo Test'): Promise<{
  tourId: string;
  bookingId: string;
}> {
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: `repo-${crypto.randomUUID()}`,
      name_es: 'Tour Repo',
      name_en: 'Repo Tour',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 90,
      meeting_point_es: 'm',
      meeting_point_en: 'm',
      includes_es: 'i',
      includes_en: 'i',
      min_participants: 1,
      max_capacity: 15,
    })
    .select('id')
    .single();
  createdTourIds.push(tour!.id);

  const { data: schedule } = await admin
    .from('tour_schedules')
    .insert({
      tour_id: tour!.id,
      day_of_week: 2,
      start_time: '10:00:00',
      capacity: 15,
      valid_from: '2026-01-01',
    })
    .select('id')
    .single();

  const { data: instance } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tour!.id,
      schedule_id: schedule!.id,
      starts_at: new Date(Date.now() + 172_800_000).toISOString(),
      ends_at: new Date(Date.now() + 176_400_000).toISOString(),
      capacity_total: 15,
      capacity_reserved: 3,
    })
    .select('id')
    .single();

  const { data: booking } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: instance!.id,
      customer_name: customerName,
      customer_email: 'repo@example.com',
      tickets_adult: 2,
      tickets_child: 1,
      total_amount_cents: 9000,
      status: 'confirmed',
    })
    .select('id')
    .single();

  return { tourId: tour!.id, bookingId: booking!.id };
}

describe('listBookingsForAdmin / listBookingsForExport (integration)', () => {
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

  it('lista (con order + range + embedding) sin romper y mapea la fila', async () => {
    const { tourId, bookingId } = await seedConfirmedBooking();

    const { rows, total } = await listBookingsForAdmin(parseBookingFilters({ tourId }));

    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(bookingId);
    expect(row.tourName).toBe('Tour Repo');
    expect(row.totalTickets).toBe(3);
    expect(row.startsAt).not.toBe('');
  });

  it('filtra por estado', async () => {
    const { tourId } = await seedConfirmedBooking();

    const confirmed = await listBookingsForAdmin(
      parseBookingFilters({ tourId, status: 'confirmed' }),
    );
    expect(confirmed.total).toBe(1);

    const cancelled = await listBookingsForAdmin(
      parseBookingFilters({ tourId, status: 'cancelled' }),
    );
    expect(cancelled.total).toBe(0);
  });

  it('el export trae las columnas extra (email, desglose, monto)', async () => {
    const { tourId } = await seedConfirmedBooking('Export Cliente');

    const rows = await listBookingsForExport(parseBookingFilters({ tourId }));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.customerEmail).toBe('repo@example.com');
    expect(row.ticketsAdult).toBe(2);
    expect(row.ticketsChild).toBe(1);
    expect(row.totalAmountCents).toBe(9000);
    expect(row.currency).toBe('USD');
  });
});
