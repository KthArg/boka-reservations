// Requiere: supabase start (Docker Desktop)
// Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TourStatus } from '@shared/constants/enums';
import type { Database } from '@/types/database';

// Valores locales de Supabase CLI (supabase start) — fallbacks = default local JWT secret
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
const anon = createClient<Database>(SUPABASE_URL, ANON_KEY);

// --- users ---

describe('users — constraints', () => {
  it('inserta admin sin teléfono', async () => {
    const { data, error } = await admin
      .from('users')
      .insert({ email: 'test-admin@test.com', role: 'admin', full_name: 'Test Admin' })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data?.role).toBe('admin');
    if (data) await admin.from('users').delete().eq('id', data.id);
  });

  it('rechaza guide sin teléfono', async () => {
    const { error } = await admin
      .from('users')
      .insert({ email: 'guide-nophone@test.com', role: 'guide', full_name: 'Sin Phone' });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/guide_requires_phone/);
  });

  it('acepta guide con teléfono', async () => {
    const { data, error } = await admin
      .from('users')
      .insert({
        email: 'guide-phone@test.com',
        role: 'guide',
        full_name: 'Con Phone',
        phone: '+506 8888-0000',
      })
      .select()
      .single();
    expect(error).toBeNull();
    if (data) await admin.from('users').delete().eq('id', data.id);
  });
});

// --- tours ---

const tourBase = {
  slug: 'test-tour',
  name_es: 'Tour de prueba',
  name_en: 'Test tour',
  description_es: 'Descripción',
  description_en: 'Description',
  difficulty: 'easy' as const,
  duration_minutes: 120,
  meeting_point_es: 'Punto A',
  meeting_point_en: 'Point A',
  includes_es: 'Guía',
  includes_en: 'Guide',
  min_participants: 1,
  max_capacity: 10,
};

describe('tours — constraints', () => {
  it('inserta tour con status active por defecto', async () => {
    const { data, error } = await admin.from('tours').insert(tourBase).select().single();
    expect(error).toBeNull();
    expect(data?.status).toBe('active');
    if (data) await admin.from('tours').delete().eq('id', data.id);
  });

  it('rechaza max_capacity < min_participants', async () => {
    const { error } = await admin
      .from('tours')
      .insert({ ...tourBase, slug: 'test-invalid', min_participants: 5, max_capacity: 2 });
    expect(error).not.toBeNull();
  });
});

// --- tour_pricing ---

describe('tour_pricing — constraints', () => {
  let tourId: string;

  beforeAll(async () => {
    const { data } = await admin
      .from('tours')
      .insert({ ...tourBase, slug: 'pricing-test' })
      .select()
      .single();
    tourId = data!.id;
  });

  afterAll(async () => {
    await admin.from('tours').delete().eq('id', tourId);
  });

  it('inserta pricing sin temporada', async () => {
    const { error } = await admin
      .from('tour_pricing')
      .insert({ tour_id: tourId, ticket_type: 'adult', price_usd: 50 });
    expect(error).toBeNull();
  });

  it('inserta pricing con temporada válida', async () => {
    const { error } = await admin.from('tour_pricing').insert({
      tour_id: tourId,
      ticket_type: 'child',
      price_usd: 30,
      season_label: 'alta',
      valid_from: '2026-12-01',
      valid_until: '2027-04-30',
    });
    expect(error).toBeNull();
  });

  it('rechaza valid_from > valid_until', async () => {
    const { error } = await admin.from('tour_pricing').insert({
      tour_id: tourId,
      ticket_type: 'student',
      price_usd: 40,
      season_label: 'test',
      valid_from: '2026-12-01',
      valid_until: '2026-06-01',
    });
    expect(error).not.toBeNull();
  });

  it('rechaza temporada sin season_label', async () => {
    const { error } = await admin.from('tour_pricing').insert({
      tour_id: tourId,
      ticket_type: 'student',
      price_usd: 40,
      valid_from: '2026-12-01',
      valid_until: '2027-04-30',
    });
    expect(error).not.toBeNull();
  });
});

// --- tour_schedules ---

describe('tour_schedules — constraints', () => {
  let tourId: string;

  beforeAll(async () => {
    const { data } = await admin
      .from('tours')
      .insert({ ...tourBase, slug: 'schedule-test' })
      .select()
      .single();
    tourId = data!.id;
  });

  afterAll(async () => {
    await admin.from('tours').delete().eq('id', tourId);
  });

  it('permite múltiples salidas el mismo día', async () => {
    const { error: e1 } = await admin
      .from('tour_schedules')
      .insert({ tour_id: tourId, day_of_week: 6, start_time: '06:00', capacity: 8 });
    const { error: e2 } = await admin
      .from('tour_schedules')
      .insert({ tour_id: tourId, day_of_week: 6, start_time: '14:00', capacity: 8 });
    expect(e1).toBeNull();
    expect(e2).toBeNull();
  });

  it('rechaza salida duplicada exacta', async () => {
    const { error } = await admin
      .from('tour_schedules')
      .insert({ tour_id: tourId, day_of_week: 6, start_time: '06:00', capacity: 8 });
    expect(error).not.toBeNull();
  });
});

// --- RLS ---

describe('RLS — anon no puede escribir', () => {
  it('anon no puede insertar tours', async () => {
    const { error } = await anon.from('tours').insert({
      ...tourBase,
      slug: 'anon-tour',
    });
    expect(error).not.toBeNull();
  });

  it('anon no puede insertar usuarios', async () => {
    const { error } = await anon
      .from('users')
      .insert({ email: 'anon@test.com', role: 'staff', full_name: 'Anon' });
    expect(error).not.toBeNull();
  });
});

describe('RLS — lectura anon', () => {
  // anon SÍ puede leer tours activos: el portal público lo requiere (spec 0004,
  // política tours_select_anon con USING status='active'). Lo que la RLS impide
  // es ver tours archivados.
  it('anon lee tours activos pero no archivados', async () => {
    const { data: active } = await admin
      .from('tours')
      .insert({ ...tourBase, slug: `rls-active-${Date.now()}`, status: 'active' })
      .select()
      .single();
    const { data: archived } = await admin
      .from('tours')
      .insert({ ...tourBase, slug: `rls-archived-${Date.now()}`, status: 'archived' })
      .select()
      .single();

    const { data, error } = await anon.from('tours').select('id, status');
    expect(error).toBeNull();
    const ids = (data ?? []).map((t) => t.id);
    expect(ids).toContain(active!.id);
    expect(ids).not.toContain(archived!.id);
    expect((data ?? []).every((t) => t.status === TourStatus.Active)).toBe(true);

    await admin.from('tours').delete().in('id', [active!.id, archived!.id]);
  });

  it('anon no puede leer usuarios', async () => {
    const { error } = await anon.from('users').select('id');
    expect(error).not.toBeNull();
  });
});
