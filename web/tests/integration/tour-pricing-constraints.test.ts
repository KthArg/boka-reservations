// Constraints de integridad de la migración …041 + reconciliación de updateTour +
// un guía por salida (spec 0028, workstream B). Requiere: supabase start.
// Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcileRows } from '@/lib/tours/reconcile';
import { TourActionError } from '@shared/constants/tours';
import type { Database } from '@/types/database';

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

// El CHECK season_label_required_with_dates exige etiqueta en filas con fechas.
function pricingRow(over: Partial<PricingInsert>): PricingInsert {
  const seasonal = over.valid_from != null || over.valid_until != null;
  return {
    tour_id: tourId,
    ticket_type: 'adult',
    price_usd: 50,
    active: true,
    ...(seasonal ? { season_label: 'Temporada' } : {}),
    ...over,
  };
}

describe('constraints de tour_pricing (…041)', () => {
  it('rechaza dos temporadas activas solapadas (incluido el día borde compartido)', async () => {
    const { error: first } = await admin
      .from('tour_pricing')
      .insert(pricingRow({ valid_from: '2026-01-01', valid_until: '2026-01-31' }));
    expect(first).toBeNull();

    const { error } = await admin
      .from('tour_pricing')
      .insert(pricingRow({ valid_from: '2026-01-31', valid_until: '2026-02-28' }));
    expect(error?.message ?? '').toContain('tour_pricing_no_seasonal_overlap');
  });

  it('permite base + temporada, pero rechaza un segundo base activo', async () => {
    const { error: base } = await admin.from('tour_pricing').insert(pricingRow({}));
    expect(base).toBeNull();

    const { error: dup } = await admin.from('tour_pricing').insert(pricingRow({ price_usd: 45 }));
    expect(dup?.message ?? '').toContain('tour_pricing_one_base_per_type');
  });
});

describe('reconcileRows — el form es el estado final (spec 0028, B1)', () => {
  it('elimina las filas quitadas y conserva/upsertea las presentes', async () => {
    const { data: existing } = await admin
      .from('tour_pricing')
      .select('id, valid_from')
      .eq('tour_id', tourId);
    const keep = existing!.find((r) => r.valid_from === null)!;

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

  it('mapea la violación del constraint de solape a su código de dominio', async () => {
    const err = await reconcileRows(
      admin as never,
      'tour_pricing',
      tourId,
      [
        pricingRow({ valid_from: '2026-03-01', valid_until: '2026-03-31' }) as never,
        pricingRow({ valid_from: '2026-03-15', valid_until: '2026-04-15' }) as never,
      ],
      TourActionError.PricingWriteFailed,
    );
    expect(err).toBe(TourActionError.PricingOverlap);
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
