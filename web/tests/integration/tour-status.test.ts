// Pausar y reanudar la venta de un tour (spec 0047 §5.2 y §5.3), contra la base real. El núcleo va
// por id sobre tours desechables sin kind; solo las acciones del panel tocan un tour fijo, y el
// archivo le devuelve su estado al terminar. La compuerta del checkout (`isTourOnSale`) también.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import { AuditAction } from '@shared/constants/audit';
import { TourStatus } from '@shared/constants/enums';
import { TourActionError } from '@shared/constants/tours';
import { deleteToursDeep } from './cleanup';
import { createDeparture, DAY_MS, must, ok, type Db } from './deferred-fixtures';

const requireRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/server', () => ({ requireRole: requireRoleMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { pauseTourById, resumeTourById } = await import('@/lib/tours/status');
const { pauseTour, resumeTour } = await import('@/lib/tours/status-action');
const { isTourOnSale } = await import('@/lib/booking/sales-gate');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SEED_ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const tourIds: string[] = [];
let tourId: string;
let instanceId: string;
let scheduleId: string;

async function statusOf(id: string): Promise<string> {
  return must(await db.from('tours').select('status').eq('id', id).single(), 'status').status;
}

async function auditCount(id: string, action: AuditAction): Promise<number> {
  const { count } = await db
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('entity_id', id)
    .eq('action', action);
  return count ?? 0;
}

async function setStatus(id: string, status: TourStatus): Promise<void> {
  ok(await db.from('tours').update({ status }).eq('id', id), 'setStatus');
}

beforeAll(async () => {
  // El fixture trae la ficha de los términos y un horario; el precio de adulto lo pone cada caso.
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourId = departure.tourId;
  instanceId = departure.instanceId;
  tourIds.push(tourId);
  scheduleId = must(
    await db.from('tour_schedules').select('id').eq('tour_id', tourId).single(),
    'schedule',
  ).id;
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

beforeEach(async () => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ id: SEED_ADMIN_ID });
  await setStatus(tourId, TourStatus.Active);
  ok(await db.from('tour_pricing').delete().eq('tour_id', tourId), 'clear pricing');
  ok(
    await db.from('tour_pricing').insert({ tour_id: tourId, ticket_type: 'adult', price_usd: 30 }),
    'pricing',
  );
  ok(await db.from('tour_schedules').update({ active: true }).eq('id', scheduleId), 'schedule');
  ok(await db.from('tours').update({ excludes_es: 'x' }).eq('id', tourId), 'info');
});

describe('pauseTourById', () => {
  it('pauses an active tour and audits it with the actor', async () => {
    // Arrange
    const before = await auditCount(tourId, AuditAction.TourPaused);

    // Act
    const result = await pauseTourById(db, tourId, SEED_ADMIN_ID);

    // Assert
    expect(result).toEqual({ ok: true });
    expect(await statusOf(tourId)).toBe(TourStatus.Paused);
    expect(await auditCount(tourId, AuditAction.TourPaused)).toBe(before + 1);
    const entry = must(
      await db
        .from('audit_logs')
        .select('actor_type, actor_id, entity_type')
        .eq('entity_id', tourId)
        .eq('action', AuditAction.TourPaused)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      'audit',
    );
    expect(entry).toEqual({ actor_type: 'admin', actor_id: SEED_ADMIN_ID, entity_type: 'tour' });
  });

  it('audits once when two admins pause at the same time', async () => {
    // Arrange
    const before = await auditCount(tourId, AuditAction.TourPaused);

    // Act
    const results = await Promise.all([
      pauseTourById(db, tourId, SEED_ADMIN_ID),
      pauseTourById(db, tourId, SEED_ADMIN_ID),
    ]);

    // Assert
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(await statusOf(tourId)).toBe(TourStatus.Paused);
    expect(await auditCount(tourId, AuditAction.TourPaused)).toBe(before + 1);
  });

  it('leaves the existing departures and bookings of the tour untouched', async () => {
    // Arrange
    const booking = must(
      await db
        .from('bookings')
        .insert({
          tour_instance_id: instanceId,
          customer_name: 'Reserva previa',
          customer_email: 'previa@example.com',
          tickets_adult: 1,
          total_amount_cents: 3000,
          status: 'confirmed',
        })
        .select('id')
        .single(),
      'booking',
    );

    // Act
    await pauseTourById(db, tourId, SEED_ADMIN_ID);

    // Assert
    const instance = must(
      await db.from('tour_instances').select('status').eq('id', instanceId).single(),
      'instance',
    );
    expect(instance.status).toBe('available');
    const after = must(
      await db.from('bookings').select('status').eq('id', booking.id).single(),
      'booking after',
    );
    expect(after.status).toBe('confirmed');
  });
});

describe('resumeTourById', () => {
  beforeEach(async () => {
    await setStatus(tourId, TourStatus.Paused);
  });

  it('resumes a complete tour and audits it', async () => {
    // Arrange
    const before = await auditCount(tourId, AuditAction.TourResumed);

    // Act
    const result = await resumeTourById(db, tourId, SEED_ADMIN_ID);

    // Assert
    expect(result).toEqual({ ok: true });
    expect(await statusOf(tourId)).toBe(TourStatus.Active);
    expect(await auditCount(tourId, AuditAction.TourResumed)).toBe(before + 1);
  });

  it('refuses to resume a tour without the published information', async () => {
    // Arrange
    ok(await db.from('tours').update({ excludes_es: '   ' }).eq('id', tourId), 'blank info');

    // Act
    const result = await resumeTourById(db, tourId, SEED_ADMIN_ID);

    // Assert
    expect(result).toEqual({ ok: false, error: TourActionError.ResumeMissingInfo });
    expect(await statusOf(tourId)).toBe(TourStatus.Paused);
  });

  it('refuses to resume a tour without an active schedule', async () => {
    // Arrange
    ok(await db.from('tour_schedules').update({ active: false }).eq('id', scheduleId), 'off');

    // Act
    const result = await resumeTourById(db, tourId, SEED_ADMIN_ID);

    // Assert
    expect(result).toEqual({ ok: false, error: TourActionError.ResumeMissingSchedule });
    expect(await statusOf(tourId)).toBe(TourStatus.Paused);
  });

  it('refuses to resume a tour whose only schedule already expired', async () => {
    // Arrange
    ok(
      await db.from('tour_schedules').update({ valid_until: '2020-01-01' }).eq('id', scheduleId),
      'expire',
    );

    // Act
    const result = await resumeTourById(db, tourId, SEED_ADMIN_ID);

    // Assert
    expect(result).toEqual({ ok: false, error: TourActionError.ResumeMissingSchedule });
    ok(await db.from('tour_schedules').update({ valid_until: null }).eq('id', scheduleId), 'undo');
  });

  it('refuses to resume a tour without an active adult price', async () => {
    // Arrange
    ok(await db.from('tour_pricing').update({ active: false }).eq('tour_id', tourId), 'no price');

    // Act
    const result = await resumeTourById(db, tourId, SEED_ADMIN_ID);

    // Assert
    expect(result).toEqual({ ok: false, error: TourActionError.ResumeMissingPrice });
    expect(await statusOf(tourId)).toBe(TourStatus.Paused);
  });
});

describe('isTourOnSale', () => {
  it('is true for a departure of a tour on sale', async () => {
    expect(await isTourOnSale(instanceId)).toBe(true);
  });

  it('is false for a departure of a paused tour', async () => {
    // Arrange
    await setStatus(tourId, TourStatus.Paused);

    // Act + Assert
    expect(await isTourOnSale(instanceId)).toBe(false);
  });

  it('is false for a departure that does not exist', async () => {
    expect(await isTourOnSale(crypto.randomUUID())).toBe(false);
  });
});

describe('pauseTour / resumeTour — acciones del panel sobre un tour fijo', () => {
  let original: Database['public']['Enums']['tour_status'];
  let nightId: string;

  beforeAll(async () => {
    const night = must(
      await db.from('tours').select('id, status').eq('kind', 'night').single(),
      'night',
    );
    nightId = night.id;
    original = night.status;
  });

  afterAll(async () => {
    ok(await db.from('tours').update({ status: original }).eq('id', nightId), 'restore night');
  });

  it('pauses and resumes the fixed tour by its kind', async () => {
    // Act
    const paused = await pauseTour('night');
    const statusWhilePaused = await statusOf(nightId);
    const resumed = await resumeTour('night');

    // Assert
    expect(paused).toEqual({ ok: true });
    expect(statusWhilePaused).toBe(TourStatus.Paused);
    expect(resumed).toEqual({ ok: true });
    expect(await statusOf(nightId)).toBe(TourStatus.Active);
  });

  it('rejects someone who is not an admin without touching the tour', async () => {
    // Arrange
    requireRoleMock.mockRejectedValue(new Error('UNAUTHORIZED'));

    // Act
    const result = await pauseTour('night');

    // Assert
    expect(result).toEqual({ ok: false, error: TourActionError.Unauthorized });
    expect(await statusOf(nightId)).toBe(original);
  });

  it('rejects a kind that is not one of the two tours', async () => {
    // Act
    const result = await pauseTour('sunset');

    // Assert
    expect(result).toEqual({ ok: false, error: TourActionError.StatusChangeFailed });
  });
});
