// Constraints de integridad de la migración …041 + reconciliación de updateTour +
// un guía por salida (spec 0028, workstream B). Requiere: supabase start.
// Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { reconcileRows } from '@/lib/tours/reconcile';
import { resolveAuthoritativeCharge } from '@/lib/booking/checkout-pricing';
import { getTourPricingForDay } from '@/lib/public/tours';
import { TourActionError } from '@shared/constants/tours';
import type { Database } from '@/types/database';

// archiveTour exige rol admin y revalida rutas; fuera de un request de Next se mockean.
vi.mock('@/lib/auth/server', () => ({
  requireRole: vi.fn().mockResolvedValue({ id: 'test-admin', userRole: 'admin' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { archiveTour } from '@/lib/tours/archive-action';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
const TEST_SLUG = `constraints-${crypto.randomUUID().slice(0, 8)}`;
let tourId: string;
let guideA: string;
let guideB: string;
let instanceId: string;

beforeAll(async () => {
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'T',
      name_en: 'T',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'P',
      meeting_point_en: 'P',
      includes_es: 'g',
      includes_en: 'g',
      min_participants: 1,
      max_capacity: 5,
    })
    .select('id')
    .single();
  tourId = tour!.id;

  const { data: sched } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 1, start_time: '08:00', capacity: 5 })
    .select('id')
    .single();
  const startsAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
  const { data: inst } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: sched!.id,
      starts_at: startsAt,
      ends_at: startsAt,
      capacity_total: 5,
    })
    .select('id')
    .single();
  instanceId = inst!.id;

  const mkGuide = async (tag: string) => {
    const { data, error } = await admin
      .from('users')
      .insert({
        email: `guide-${tag}-${crypto.randomUUID().slice(0, 8)}@example.com`,
        full_name: `Guide ${tag}`,
        role: 'guide',
        phone: '+506 8000-0000',
      })
      .select('id')
      .single();
    if (error) throw new Error(`mkGuide: ${error.message}`);
    return data!.id;
  };
  guideA = await mkGuide('a');
  guideB = await mkGuide('b');
});

afterAll(async () => {
  await admin.from('tour_instance_guides').delete().eq('tour_instance_id', instanceId);
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tour_pricing').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
  await admin.from('users').delete().in('id', [guideA, guideB]);
});

type PricingInsert = Database['public']['Tables']['tour_pricing']['Insert'];

// Temporada día-mes (spec 0040): el CHECK tour_pricing_season_shape exige nombre.
function pricingRow(over: Partial<PricingInsert>): PricingInsert {
  const seasonal = over.season_start != null || over.season_end != null;
  return {
    tour_id: tourId,
    ticket_type: 'adult',
    price_usd: 50,
    active: true,
    ...(seasonal ? { season_label: 'Temporada' } : {}),
    ...over,
  };
}

async function clearPricing() {
  await admin.from('tour_pricing').delete().eq('tour_id', tourId);
}

function insert(...rows: Partial<PricingInsert>[]) {
  return admin.from('tour_pricing').insert(rows.map(pricingRow));
}

/** Día-mes de una fecha ISO en Costa Rica. */
function crMonthDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' }).slice(5);
}

describe('superposición de temporadas (trigger de …052, spec 0040)', () => {
  it('rechaza dos temporadas activas que comparten el día borde', async () => {
    await clearPricing();
    expect((await insert({ season_start: '01-01', season_end: '01-31' })).error).toBeNull();

    const { error } = await insert({ season_start: '01-31', season_end: '02-28' });
    expect(error?.code).toBe('23P01');
    expect(error?.message ?? '').toContain('tour_pricing_season_overlap');
  });

  it('rechaza el choque con una temporada que cruza el año', async () => {
    await clearPricing();
    expect((await insert({ season_start: '12-15', season_end: '04-30' })).error).toBeNull();
    const { error } = await insert({ season_start: '01-10', season_end: '01-20' });
    expect(error?.code).toBe('23P01');
  });

  it('acepta temporadas contiguas y el mismo día en otro tiquete', async () => {
    await clearPricing();
    const { error } = await insert(
      { season_start: '12-15', season_end: '04-30' },
      { season_start: '05-01', season_end: '12-14' },
      { season_start: '12-15', season_end: '04-30', ticket_type: 'child' },
    );
    expect(error).toBeNull();
  });

  it('el 29/02 choca con un rango que lo incluye', async () => {
    await clearPricing();
    expect((await insert({ season_start: '02-28', season_end: '03-01' })).error).toBeNull();
    const { error } = await insert({ season_start: '02-29', season_end: '02-29' });
    expect(error?.code).toBe('23P01');
  });

  it('rechaza activar una temporada inactiva que choca', async () => {
    await clearPricing();
    await insert({ season_start: '06-01', season_end: '06-30' });
    const { data } = await insert({ season_start: '06-15', season_end: '07-15', active: false })
      .select('id')
      .single();
    const { error } = await admin.from('tour_pricing').update({ active: true }).eq('id', data!.id);
    expect(error?.code).toBe('23P01');
  });

  it('rechaza un segundo precio base activo; base + temporada conviven', async () => {
    await clearPricing();
    expect((await insert({}, { season_start: '12-15', season_end: '04-30' })).error).toBeNull();
    const { error: dup } = await insert({ price_usd: 45 });
    expect(dup?.message ?? '').toContain('tour_pricing_one_base_per_type');
  });
});

describe('reconcileRows — el form es el estado final (spec 0028, B1; spec 0040)', () => {
  it('elimina las filas quitadas y conserva/upsertea las presentes', async () => {
    await clearPricing();
    await insert({}, { season_start: '01-01', season_end: '01-31' });
    const { data: existing } = await admin
      .from('tour_pricing')
      .select('id, season_start')
      .eq('tour_id', tourId);
    const keep = existing!.find((r) => r.season_start === null)!;

    // Se envía SOLO el precio base (la temporada de enero se quitó del form).
    const err = await reconcileRows(
      admin as never,
      'tour_pricing',
      tourId,
      [{ id: keep.id, tour_id: tourId, ticket_type: 'adult', price_usd: 55, active: true }],
      TourActionError.PricingWriteFailed,
    );
    expect(err).toBeNull();

    const { data: after } = await admin
      .from('tour_pricing')
      .select('id, price_usd')
      .eq('tour_id', tourId);
    expect(after).toHaveLength(1);
    expect(after![0]).toMatchObject({ id: keep.id, price_usd: 55 });
  });

  it('correr el borde entre dos temporadas en un solo guardado funciona', async () => {
    await clearPricing();
    const { data: rows } = await insert(
      { season_start: '12-15', season_end: '04-30', season_label: 'alta' },
      { season_start: '05-01', season_end: '12-14', season_label: 'baja' },
    ).select('id, season_label');
    const high = rows!.find((r) => r.season_label === 'alta')!;
    const low = rows!.find((r) => r.season_label === 'baja')!;

    const err = await reconcileRows(
      admin as never,
      'tour_pricing',
      tourId,
      [
        pricingRow({
          id: high.id,
          season_start: '12-15',
          season_end: '05-15',
          season_label: 'alta',
        }) as never,
        pricingRow({
          id: low.id,
          season_start: '05-16',
          season_end: '12-14',
          season_label: 'baja',
        }) as never,
      ],
      TourActionError.PricingWriteFailed,
    );
    expect(err).toBeNull();
  });

  it('mapea el error del trigger de superposición a su código de dominio', async () => {
    await clearPricing();
    const err = await reconcileRows(
      admin as never,
      'tour_pricing',
      tourId,
      [
        pricingRow({ season_start: '03-01', season_end: '03-31' }) as never,
        pricingRow({ season_start: '03-15', season_end: '04-15' }) as never,
      ],
      TourActionError.PricingWriteFailed,
    );
    expect(err).toBe(TourActionError.PricingOverlap);
  });
});

describe('el COBRO usa el día de la salida (spec 0040)', () => {
  it('cobra la temporada del día de la salida aunque hoy no esté en ella', async () => {
    const { data: inst } = await admin
      .from('tour_instances')
      .select('starts_at')
      .eq('id', instanceId)
      .single();
    const departureDay = crMonthDay(inst!.starts_at);
    await clearPricing();
    expect(
      (
        await insert(
          { price_usd: 40 },
          { price_usd: 60, season_start: departureDay, season_end: departureDay },
        )
      ).error,
    ).toBeNull();

    const { totalAmountCents } = await resolveAuthoritativeCharge(
      admin as never,
      instanceId,
      { adult: 1, child: 0, student: 0 },
      'es',
    );

    expect(totalAmountCents).toBe(6000);
  });

  it('una temporada de hoy que no incluye el día de la salida no se cobra', async () => {
    const today = crMonthDay(new Date().toISOString());
    const { data: inst } = await admin
      .from('tour_instances')
      .select('starts_at')
      .eq('id', instanceId)
      .single();
    expect(crMonthDay(inst!.starts_at)).not.toBe(today);
    await clearPricing();
    await insert({ price_usd: 40 }, { price_usd: 60, season_start: today, season_end: today });

    const { totalAmountCents } = await resolveAuthoritativeCharge(
      admin as never,
      instanceId,
      { adult: 1, child: 0, student: 0 },
      'es',
    );

    expect(totalAmountCents).toBe(4000);
  });

  it('la pantalla del checkout recibe el mismo precio que se cobra', async () => {
    const { data: inst } = await admin
      .from('tour_instances')
      .select('starts_at')
      .eq('id', instanceId)
      .single();
    const departureDay = crMonthDay(inst!.starts_at);
    const crDay = new Date(inst!.starts_at).toLocaleDateString('en-CA', {
      timeZone: 'America/Costa_Rica',
    });
    await clearPricing();
    await insert(
      { price_usd: 40 },
      { price_usd: 60, season_start: departureDay, season_end: departureDay },
    );

    const shown = await getTourPricingForDay(tourId, crDay);
    const { totalAmountCents } = await resolveAuthoritativeCharge(
      admin as never,
      instanceId,
      { adult: 1, child: 0, student: 0 },
      'es',
    );

    expect(shown.map((p) => Number(p.price_usd))).toEqual([60]);
    expect(totalAmountCents).toBe(6000);
  });
});

describe('un guía por salida (…041 + B9)', () => {
  it('dos upserts concurrentes dejan UNA sola fila (gana el último)', async () => {
    const upsert = (guideId: string) =>
      admin
        .from('tour_instance_guides')
        .upsert(
          { tour_instance_id: instanceId, guide_id: guideId },
          { onConflict: 'tour_instance_id' },
        );

    const [a, b] = await Promise.all([upsert(guideA), upsert(guideB)]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    const { data: rows } = await admin
      .from('tour_instance_guides')
      .select('guide_id')
      .eq('tour_instance_id', instanceId);
    expect(rows).toHaveLength(1);
  });
});

describe('archiveTour (spec 0028, B12)', () => {
  it('bloquea con reserva activa futura; sin ella cancela las salidas y archiva', async () => {
    const { data: booking } = await admin
      .from('bookings')
      .insert({
        tour_instance_id: instanceId,
        customer_name: 'Archive Test',
        customer_email: 'archive@example.com',
        tickets_adult: 1,
        total_amount_cents: 1000,
        locale: 'es',
        status: 'confirmed',
      })
      .select('id')
      .single();

    const blocked = await archiveTour(tourId);
    expect(blocked).toEqual({ ok: false, error: TourActionError.ArchiveHasBookings });
    const { data: still } = await admin
      .from('tour_instances')
      .select('status')
      .eq('id', instanceId)
      .single();
    expect(still!.status).toBe('available');

    await admin.from('bookings').delete().eq('id', booking!.id);

    const ok = await archiveTour(tourId);
    expect(ok).toEqual({ ok: true });
    const { data: after } = await admin
      .from('tour_instances')
      .select('status')
      .eq('id', instanceId)
      .single();
    expect(after!.status).toBe('cancelled');
    const { data: tour } = await admin.from('tours').select('status').eq('id', tourId).single();
    expect(tour!.status).toBe('archived');
  });
});
