// createTour / updateTour persisten charge_timing y charge_lead_hours (spec 0033 §5.1). La
// escritura corre con una sesión de admin real, así que la RLS de tours aplica. Se mockean solo
// las fronteras de Next que no existen en vitest: requireRole, el cliente de sesión, redirect y
// getLocale. Hermano de tour-minimum-policy-action.test.ts.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTour, updateTour } from '@/lib/tours/actions';
import { ChargeTiming } from '@shared/constants/tours';
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
    name_es: 'Tour cobro',
    name_en: 'Charge tour',
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

type ChargeColumns = { id: string; charge_timing: string; charge_lead_hours: number | null };

async function chargeConfigFor(slug: string): Promise<ChargeColumns> {
  const { data, error } = await service
    .from('tours')
    .select('id, charge_timing, charge_lead_hours')
    .eq('slug', slug)
    .single();
  if (error) throw new Error(`chargeConfigFor ${slug}: ${error.message}`);
  createdTourIds.push(data.id);
  return data;
}

function newSlug(): string {
  return `cobro-accion-${crypto.randomUUID().slice(0, 8)}`;
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

describe('tour actions — charge_timing y charge_lead_hours', () => {
  it('saves a tour that charges as soon as the minimum is met, without a lead time', async () => {
    // Arrange: con "al cumplirse el mínimo" el formulario no renderiza el campo de horas.
    const slug = newSlug();

    // Act
    const result = await createTour(
      null,
      tourForm(slug, { charge_timing: ChargeTiming.OnMinimum }),
    );

    // Assert: redirect (mockeado) significa éxito; un error devolvería { success: false }.
    expect(result).toBeUndefined();
    const saved = await chargeConfigFor(slug);
    expect(saved.charge_timing).toBe(ChargeTiming.OnMinimum);
    expect(saved.charge_lead_hours).toBeNull();
  });

  it('saves a tour that charges before departure with its own lead time', async () => {
    // Arrange
    const slug = newSlug();

    // Act
    const result = await createTour(
      null,
      tourForm(slug, {
        charge_timing: ChargeTiming.BeforeDeparture,
        charge_lead_hours: '12',
      }),
    );

    // Assert
    expect(result).toBeUndefined();
    const saved = await chargeConfigFor(slug);
    expect(saved.charge_timing).toBe(ChargeTiming.BeforeDeparture);
    expect(saved.charge_lead_hours).toBe(12);
  });

  it('leaves the lead time empty so the global default applies', async () => {
    // Arrange
    const slug = newSlug();

    // Act
    const result = await createTour(
      null,
      tourForm(slug, { charge_timing: ChargeTiming.BeforeDeparture, charge_lead_hours: '' }),
    );

    // Assert
    expect(result).toBeUndefined();
    expect((await chargeConfigFor(slug)).charge_lead_hours).toBeNull();
  });

  it('defaults to charging before departure when the form has no timing field', async () => {
    // Arrange: tours creados antes del spec 0033 (y cualquier form sin el campo).
    const slug = newSlug();

    // Act
    const result = await createTour(null, tourForm(slug));

    // Assert
    expect(result).toBeUndefined();
    const saved = await chargeConfigFor(slug);
    expect(saved.charge_timing).toBe(ChargeTiming.BeforeDeparture);
    expect(saved.charge_lead_hours).toBeNull();
  });

  it('clears the lead time when an edit switches to charging on the minimum', async () => {
    // Arrange
    const slug = newSlug();
    await createTour(
      null,
      tourForm(slug, { charge_timing: ChargeTiming.BeforeDeparture, charge_lead_hours: '12' }),
    );
    const { id } = await chargeConfigFor(slug);

    // Act
    const result = await updateTour(
      id,
      null,
      tourForm(slug, {
        charge_timing: ChargeTiming.OnMinimum,
      }),
    );

    // Assert
    expect(result).toBeUndefined();
    const saved = await chargeConfigFor(slug);
    expect(saved.charge_timing).toBe(ChargeTiming.OnMinimum);
    expect(saved.charge_lead_hours).toBeNull();
  });

  it.each(['0', '721'])('rejects %j as a lead time, without creating the tour', async (raw) => {
    // Arrange
    const slug = newSlug();

    // Act
    const result = await createTour(
      null,
      tourForm(slug, { charge_timing: ChargeTiming.BeforeDeparture, charge_lead_hours: raw }),
    );

    // Assert
    expect(result).toMatchObject({ success: false });
    expect(
      (result as { success: false; errors: Record<string, string[]> }).errors.charge_lead_hours,
    ).toBeDefined();
    const { data } = await service.from('tours').select('id').eq('slug', slug).maybeSingle();
    expect(data).toBeNull();
  });
});
