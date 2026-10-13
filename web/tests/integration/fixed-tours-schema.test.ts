// Los dos tours fijos en la base (spec 0047, migración …061): kind único, sin archivar, sin cambiar
// de kind ni de slug, sin borrar; nadie crea ni borra tours con una sesión del panel; anon lee los
// tours en pausa. Los tours desechables de este archivo no llevan kind.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';
const PG_PERMISSION_DENIED = '42501';
const FIXED_TOUR_LOCKED = 'FIXED_TOUR_LOCKED';

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const service = createClient<Database>(SUPABASE_URL, SERVICE_KEY, noSession);
const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, noSession);
let adminSession: SupabaseClient<Database>;
const createdTourIds: string[] = [];

function tourRow(status: 'active' | 'paused' | 'archived' = 'active') {
  return {
    slug: `fijos-${crypto.randomUUID().slice(0, 8)}`,
    name_es: 'Tour desechable',
    name_en: 'Disposable tour',
    description_es: 'd',
    description_en: 'd',
    difficulty: 'easy' as const,
    duration_minutes: 60,
    meeting_point_es: 'P',
    meeting_point_en: 'P',
    includes_es: 'g',
    includes_en: 'g',
    max_capacity: 10,
    status,
  };
}

async function insertTour(status: 'active' | 'paused' | 'archived'): Promise<string> {
  const { data, error } = await service.from('tours').insert(tourRow(status)).select('id').single();
  if (error) throw new Error(`insertTour: ${error.message}`);
  createdTourIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  adminSession = createClient<Database>(SUPABASE_URL, ANON_KEY, noSession);
  const { error } = await adminSession.auth.signInWithPassword({
    email: 'admin@bokatrails.com',
    password: 'admin1234',
  });
  if (error) throw new Error(`signIn admin: ${error.message}`);
});

afterAll(async () => {
  await deleteToursDeep(service, createdTourIds);
  await adminSession.auth.signOut({ scope: 'local' });
});

describe('tours fijos — esquema', () => {
  it('has exactly one day tour and one night tour', async () => {
    // Act
    const { data, error } = await service.from('tours').select('kind').not('kind', 'is', null);

    // Assert
    expect(error).toBeNull();
    expect((data ?? []).map((t) => t.kind).sort()).toEqual(['day', 'night']);
  });

  it('rejects a second tour of the same kind', async () => {
    // Act
    const { error } = await service.from('tours').insert({ ...tourRow(), kind: 'day' });

    // Assert
    expect(error?.code).toBe(PG_UNIQUE_VIOLATION);
  });

  it('refuses to archive a fixed tour', async () => {
    // Act
    const { error } = await service.from('tours').update({ status: 'archived' }).eq('kind', 'day');

    // Assert
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it.each([
    ['kind', { kind: 'night' as const }],
    ['slug', { slug: 'otro-slug' }],
  ])('refuses to change the %s of a fixed tour, even for service_role', async (_column, patch) => {
    // Act
    const { error } = await service.from('tours').update(patch).eq('kind', 'day');

    // Assert
    expect(error?.message).toContain(FIXED_TOUR_LOCKED);
  });

  it('refuses to delete a fixed tour, even for service_role', async () => {
    // Act
    const { error } = await service.from('tours').delete().eq('kind', 'night');

    // Assert
    expect(error?.message).toContain(FIXED_TOUR_LOCKED);
    const { data } = await service.from('tours').select('id').eq('kind', 'night');
    expect(data).toHaveLength(1);
  });

  it('still lets service_role insert and delete a tour without kind', async () => {
    // Arrange
    const id = await insertTour('active');

    // Act
    const { error } = await service.from('tours').delete().eq('id', id);

    // Assert
    expect(error).toBeNull();
    const { data } = await service.from('tours').select('id').eq('id', id);
    expect(data).toEqual([]);
  });
});

describe('tours fijos — permisos', () => {
  it('denies an admin session inserting a tour', async () => {
    // Act
    const { error } = await adminSession.from('tours').insert(tourRow());

    // Assert
    expect(error?.code).toBe(PG_PERMISSION_DENIED);
  });

  it('denies an admin session deleting a tour', async () => {
    // Arrange
    const id = await insertTour('active');

    // Act
    const { error } = await adminSession.from('tours').delete().eq('id', id);

    // Assert
    expect(error?.code).toBe(PG_PERMISSION_DENIED);
    const { data } = await service.from('tours').select('id').eq('id', id);
    expect(data).toHaveLength(1);
  });

  it('lets anon read a paused tour but not an archived one', async () => {
    // Arrange
    const paused = await insertTour('paused');
    const archived = await insertTour('archived');

    // Act
    const { data, error } = await anon.from('tours').select('id').in('id', [paused, archived]);

    // Assert
    expect(error).toBeNull();
    expect((data ?? []).map((t) => t.id)).toEqual([paused]);
  });
});
