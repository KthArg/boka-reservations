// createTour / updateTour persisten auto_cancel_below_minimum (spec 0029). La escritura corre
// con una sesión de admin real, así que la RLS de tours aplica. Se mockean solo las fronteras
// de Next que no existen en vitest: requireRole, el cliente de sesión, redirect y getLocale.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTour, updateTour } from '@/lib/tours/actions';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';

const requireRoleMock = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/auth/server', () => ({ requireRole: requireRoleMock }));
vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'es' }));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const service = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let adminSession: SupabaseClient<Database>;
const createdTourIds: string[] = [];

function tourForm(slug: string, extra: Record<string, string> = {}): FormData {
  const fields: Record<string, string> = {
    slug,
    name_es: 'Tour mínimo',
    name_en: 'Minimum tour',
    description_es: 'd',
    description_en: 'd',
    difficulty: 'easy',
    duration_minutes: '60',
    meeting_point_es: 'P',
    meeting_point_en: 'P',
    includes_es: 'g',
    includes_en: 'g',
    min_participants: '4',
    max_capacity: '10',
    cover_image_url: '',
    pricing: '[]',
    schedules: '[]',
    ...extra,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

async function toggleFor(
  slug: string,
): Promise<{ id: string; auto_cancel_below_minimum: boolean }> {
  const { data, error } = await service
    .from('tours')
    .select('id, auto_cancel_below_minimum')
    .eq('slug', slug)
    .single();
  if (error) throw new Error(`toggleFor ${slug}: ${error.message}`);
  createdTourIds.push(data.id);
  return data;
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
  // scope local: el signOut por defecto es global y cerraría también las sesiones del
  // navegador de quien corre la suite con el mismo usuario del seed.
  await adminSession.auth.signOut({ scope: 'local' });
});

describe('tour actions — auto_cancel_below_minimum', () => {
  it('creates a tour with automatic cancellation when the box is checked', async () => {
    // Arrange
    const slug = `minimo-accion-${crypto.randomUUID().slice(0, 8)}`;

    // Act
    const result = await createTour(null, tourForm(slug, { auto_cancel_below_minimum: 'on' }));

    // Assert: redirect (mockeado) significa éxito; un error devolvería { success: false }.
    expect(result).toBeUndefined();
    expect((await toggleFor(slug)).auto_cancel_below_minimum).toBe(true);
  });

  it('turns automatic cancellation off when an edit leaves the box unchecked', async () => {
    // Arrange
    const slug = `minimo-accion-${crypto.randomUUID().slice(0, 8)}`;
    await createTour(null, tourForm(slug, { auto_cancel_below_minimum: 'on' }));
    const { id } = await toggleFor(slug);

    // Act
    const result = await updateTour(id, null, tourForm(slug));

    // Assert
    expect(result).toBeUndefined();
    expect((await toggleFor(slug)).auto_cancel_below_minimum).toBe(false);
  });
});
