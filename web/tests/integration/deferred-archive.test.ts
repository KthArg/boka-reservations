// Archivado de un tour con reservas sin cobrar (spec 0029): una pending_minimum ocupa cupo y tiene
// tarjeta guardada, así que bloquea el archivado igual que una confirmada (spec 0028, B12).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import { TourActionError } from '@shared/constants/tours';
import { deleteToursDeep } from './cleanup';
import {
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  must,
  ok,
  type Db,
} from './deferred-fixtures';

// archiveTour exige rol admin y revalida rutas; fuera de un request de Next se mockean.
vi.mock('@/lib/auth/server', () => ({
  requireRole: vi.fn().mockResolvedValue({ id: 'test-admin', userRole: 'admin' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { archiveTour } = await import('@/lib/tours/archive-action');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tourIds: string[] = [];

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

describe('archiveTour — reservas sin cobrar', () => {
  it('blocks archiving a tour with an unpaid booking on a future departure', async () => {
    // Arrange
    const departure = await createDeparture(db, 10 * DAY_MS);
    tourIds.push(departure.tourId);
    await createDeferredBooking(db, departure.instanceId);

    // Act
    const result = await archiveTour(departure.tourId);

    // Assert
    expect(result).toEqual({ ok: false, error: TourActionError.ArchiveHasBookings });
    const instance = must(
      await db.from('tour_instances').select('status').eq('id', departure.instanceId).single(),
      'instance',
    );
    expect(instance.status).toBe('available');
  });

  // Archivar cancela la salida, y el motor del mínimo no toca salidas canceladas: el ciclo
  // quedaría abierto para siempre (spec 0033 §5.9). El caso llega acá cuando todas las reservas
  // de la salida ya se cancelaron y el ciclo sigue abierto.
  it('blocks archiving a tour whose departure is in the middle of its charge cycle', async () => {
    // Arrange
    const departure = await createDeparture(db, 10 * DAY_MS);
    tourIds.push(departure.tourId);
    ok(
      await db
        .from('tours')
        .update({ charge_timing: 'before_departure', charge_lead_hours: 720 })
        .eq('id', departure.tourId),
      'charge timing',
    );
    const opened = must(
      await db.rpc('open_departure_charge', { p_instance_id: departure.instanceId }),
      'open_departure_charge',
    );
    expect(opened).toBe('opened');

    // Act
    const result = await archiveTour(departure.tourId);

    // Assert
    expect(result).toEqual({ ok: false, error: TourActionError.ArchiveChargeInProgress });
    const instance = must(
      await db.from('tour_instances').select('status').eq('id', departure.instanceId).single(),
      'instance',
    );
    expect(instance.status).toBe('available');
  });
});
