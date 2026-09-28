// Términos definitivos y publicación (spec 0034, migración …048): la tolerancia de llegada tarde
// que copia cada reserva, quién puede editar la identidad del operador, y los CHECK nuevos.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';
import {
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  readBooking,
  type Db,
} from './deferred-fixtures';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const CHECK_VIOLATION = '23514';

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tourIds: string[] = [];
let instanceId: string;
let originalTolerance: number;

async function signIn(email: string, password: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

async function setTolerance(minutes: number): Promise<void> {
  const { error } = await db
    .from('business_settings')
    .update({ no_show_tolerance_minutes: minutes })
    .eq('id', 1);
  if (error) throw new Error(`setTolerance: ${error.message}`);
}

beforeAll(async () => {
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
  const { data } = await db
    .from('business_settings')
    .select('no_show_tolerance_minutes')
    .eq('id', 1)
    .single();
  originalTolerance = data!.no_show_tolerance_minutes;
});

afterAll(async () => {
  await setTolerance(originalTolerance);
  await deleteToursDeep(db, tourIds);
});

describe('tolerancia de llegada tarde', () => {
  it('cada reserva copia la tolerancia vigente al crearse', async () => {
    // Arrange
    await setTolerance(20);

    // Act
    const { bookingId } = await createDeferredBooking(db, instanceId);

    // Assert
    expect((await readBooking(db, bookingId)).no_show_tolerance_minutes).toBe(20);
  });

  it('cambiar la tolerancia no altera las reservas ya hechas', async () => {
    // Arrange
    await setTolerance(10);
    const { bookingId } = await createDeferredBooking(db, instanceId);

    // Act
    await setTolerance(45);

    // Assert
    expect((await readBooking(db, bookingId)).no_show_tolerance_minutes).toBe(10);
  });

  it.each([-1, 121])('rechaza una tolerancia de %i minutos', async (minutes) => {
    const { error } = await db
      .from('business_settings')
      .update({ no_show_tolerance_minutes: minutes })
      .eq('id', 1);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});

describe('identidad del operador', () => {
  it('el staff no puede editarla', async () => {
    // Arrange
    const staff = await signIn('staff@bokatrails.com', 'staff1234');

    // Act
    const { data } = await staff
      .from('business_settings')
      .update({ operator_legal_name: 'Otra razón social' })
      .eq('id', 1)
      .select('id');

    // Assert: la RLS filtra la fila; nada cambia.
    expect(data ?? []).toHaveLength(0);
    const { data: row } = await db
      .from('business_settings')
      .select('operator_legal_name')
      .eq('id', 1)
      .single();
    expect(row!.operator_legal_name).not.toBe('Otra razón social');
  });
});

describe('información del tour', () => {
  it('rechaza edades del tiquete de niño invertidas', async () => {
    const { error } = await db
      .from('tours')
      .update({ child_age_min: 12, child_age_max: 6 })
      .eq('id', tourIds[0]!);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it('rechaza una sola de las dos edades', async () => {
    const { error } = await db
      .from('tours')
      .update({ child_age_min: 6, child_age_max: null })
      .eq('id', tourIds[0]!);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});
