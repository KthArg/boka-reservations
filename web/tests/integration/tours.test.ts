// Tours CRUD — flujos de integración vía cliente Supabase con service role.
// Requiere: supabase start (Docker Desktop)
// Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const db = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

const SLUG = 'integration-tours-test';

const tourBase = {
  slug: SLUG,
  name_es: 'Tour de integración',
  name_en: 'Integration tour',
  description_es: 'Descripción de prueba',
  description_en: 'Test description',
  difficulty: 'easy' as const,
  duration_minutes: 90,
  meeting_point_es: 'Portón principal',
  meeting_point_en: 'Main gate',
  includes_es: 'Guía, agua',
  includes_en: 'Guide, water',
  min_participants: 2,
  max_capacity: 10,
};

describe('tours — flujo CRUD completo', () => {
  let tourId: string;

  beforeAll(async () => {
    await db.from('tours').delete().eq('slug', SLUG);
  });

  afterAll(async () => {
    if (tourId) await db.from('tours').delete().eq('id', tourId);
  });

  it('crea un tour con precios y horarios', async () => {
    const { data, error } = await db.from('tours').insert(tourBase).select().single();
    expect(error).toBeNull();
    expect(data?.status).toBe('active');
    tourId = data!.id;

    const { error: pe } = await db
      .from('tour_pricing')
      .insert({ tour_id: tourId, ticket_type: 'adult', price_usd: 65 });
    expect(pe).toBeNull();

    const { error: se } = await db
      .from('tour_schedules')
      .insert({ tour_id: tourId, day_of_week: 5, start_time: '07:00', capacity: 8 });
    expect(se).toBeNull();
  });

  it('actualiza campos del tour y los persiste correctamente', async () => {
    const { error } = await db
      .from('tours')
      .update({ name_es: 'Tour actualizado', duration_minutes: 120 })
      .eq('id', tourId);
    expect(error).toBeNull();

    const { data } = await db
      .from('tours')
      .select('name_es, duration_minutes')
      .eq('id', tourId)
      .single();
    expect(data?.name_es).toBe('Tour actualizado');
    expect(data?.duration_minutes).toBe(120);
  });

  it('recupera el tour con precios y horarios relacionados', async () => {
    const [{ data: pricingData }, { data: scheduleData }] = await Promise.all([
      db.from('tour_pricing').select('*').eq('tour_id', tourId),
      db.from('tour_schedules').select('*').eq('tour_id', tourId),
    ]);
    expect(pricingData).toHaveLength(1);
    expect(scheduleData).toHaveLength(1);
  });

  it('archiva el tour (status = archived)', async () => {
    const { error } = await db.from('tours').update({ status: 'archived' }).eq('id', tourId);
    expect(error).toBeNull();
    const { data } = await db.from('tours').select('status').eq('id', tourId).single();
    expect(data?.status).toBe('archived');
  });

  it('reactiva el tour (status = active)', async () => {
    const { error } = await db.from('tours').update({ status: 'active' }).eq('id', tourId);
    expect(error).toBeNull();
    const { data } = await db.from('tours').select('status').eq('id', tourId).single();
    expect(data?.status).toBe('active');
  });

  it('rechaza un segundo tour con el mismo slug', async () => {
    const { error } = await db.from('tours').insert({ ...tourBase, slug: SLUG });
    expect(error).not.toBeNull();
  });
});
