// Purga de reservas temporales de cupo y de la cola de correos (spec 0031, §5.2 y §5.4), contra la
// DB real. Además verifica que apply-retention corre purge_stale_holds después de
// purge_unpaid_bookings: un hold que esa purga deja sin reserva se borra en la misma corrida.
// Requiere: supabase start.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DAY_MS,
  createDeparture,
  db,
  deleteDepartures,
  isoFromNow,
  must,
  ok,
} from './deferred-fixtures.js';

const mockEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  APP_URL: 'http://localhost:3000',
  RETENTION_ENABLED: true,
};
vi.mock('../../src/env.js', () => ({ env: mockEnv }));

const { applyRetention } = await import('../../src/jobs/apply-retention.js');

const HOLD_CUTOFF = () => isoFromNow(-7 * DAY_MS);
const NOTIFICATION_CUTOFF = () => isoFromNow(-90 * DAY_MS);
const OLD = () => isoFromNow(-10 * DAY_MS);
const VERY_OLD = () => isoFromNow(-120 * DAY_MS);

const tourIds: string[] = [];
let instanceId: string;

type HoldSeed = {
  status: 'active' | 'paying' | 'released' | 'expired' | 'converted';
  createdAt: string;
  customerExternalId?: string;
  customerCleanedAt?: string;
};

async function seedHold(seed: HoldSeed): Promise<string> {
  const hold = must(
    await db
      .from('tour_holds')
      .insert({
        tour_instance_id: instanceId,
        session_token: crypto.randomUUID(),
        held_seats: 1,
        status: seed.status,
        created_at: seed.createdAt,
        customer_external_id: seed.customerExternalId ?? null,
        customer_cleaned_at: seed.customerCleanedAt ?? null,
      })
      .select('id')
      .single(),
    'seedHold',
  );
  return hold.id;
}

async function seedBooking(
  holdId: string | null,
  status: 'confirmed' | 'cancelled' | 'pending_payment',
  createdAt = new Date().toISOString(),
): Promise<string> {
  const booking = must(
    await db
      .from('bookings')
      .insert({
        tour_instance_id: instanceId,
        hold_id: holdId,
        customer_name: 'Retención',
        customer_email: `retencion-${crypto.randomUUID().slice(0, 8)}@example.com`,
        tickets_adult: 1,
        total_amount_cents: 1000,
        locale: 'es',
        status,
        created_at: createdAt,
      })
      .select('id')
      .single(),
    'seedBooking',
  );
  return booking.id;
}

async function existingHolds(ids: string[]): Promise<string[]> {
  const rows = must(await db.from('tour_holds').select('id').in('id', ids), 'existingHolds');
  return rows.map((row) => row.id);
}

beforeAll(async () => {
  const departure = await createDeparture(30 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
});

afterAll(async () => {
  await deleteDepartures(tourIds);
});

describe('purge_stale_holds', () => {
  it('borra solo holds terminales viejos, sin reserva y sin cliente de OnvoPay pendiente', async () => {
    // Arrange
    const expiredOrphan = await seedHold({ status: 'expired', createdAt: OLD() });
    const convertedOrphan = await seedHold({ status: 'converted', createdAt: OLD() });
    const cleanedCustomer = await seedHold({
      status: 'released',
      createdAt: OLD(),
      customerExternalId: `cus_${crypto.randomUUID()}`,
      customerCleanedAt: OLD(),
    });
    const active = await seedHold({ status: 'active', createdAt: OLD() });
    const paying = await seedHold({ status: 'paying', createdAt: OLD() });
    const convertedReferenced = await seedHold({ status: 'converted', createdAt: OLD() });
    await seedBooking(convertedReferenced, 'confirmed');
    const releasedReferenced = await seedHold({ status: 'released', createdAt: OLD() });
    await seedBooking(releasedReferenced, 'cancelled');
    const pendingCustomer = await seedHold({
      status: 'released',
      createdAt: OLD(),
      customerExternalId: `cus_${crypto.randomUUID()}`,
    });
    const recent = await seedHold({ status: 'expired', createdAt: isoFromNow(-DAY_MS) });

    // Act
    const { error } = await db.rpc('purge_stale_holds', { p_cutoff: HOLD_CUTOFF() });

    // Assert
    expect(error).toBeNull();
    const kept = [active, paying, convertedReferenced, releasedReferenced, pendingCustomer, recent];
    const purged = [expiredOrphan, convertedOrphan, cleanedCustomer];
    expect((await existingHolds([...kept, ...purged])).sort()).toEqual([...kept].sort());
  });

  it('registra la corrida en la bitácora con el conteo, sin datos personales', async () => {
    // Arrange: el cutoff exacto identifica la fila de esta corrida sin depender de relojes.
    await seedHold({ status: 'expired', createdAt: OLD() });
    const cutoff = HOLD_CUTOFF();

    // Act
    const { data: count, error } = await db.rpc('purge_stale_holds', { p_cutoff: cutoff });

    // Assert
    expect(error).toBeNull();
    // El cutoff vuelve de jsonb como `+00:00`: se compara como instante, no como texto.
    const recent = must(
      await db
        .from('audit_logs')
        .select('metadata')
        .eq('action', 'retention.purged_holds')
        .order('created_at', { ascending: false })
        .limit(20),
      'audit',
    );
    const entries = recent.filter(
      (row) =>
        new Date(String((row.metadata as Record<string, unknown>).cutoff)).getTime() ===
        new Date(cutoff).getTime(),
    );
    expect(entries).toHaveLength(1);
    const metadata = entries[0]?.metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual(['affected_count', 'cutoff']);
    expect(metadata.affected_count).toBe(count);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('borra un hold liberado sin cliente de OnvoPay, el caso común del cobro inmediato', async () => {
    // Arrange
    const released = await seedHold({ status: 'released', createdAt: OLD() });

    // Act
    const { error } = await db.rpc('purge_stale_holds', { p_cutoff: HOLD_CUTOFF() });

    // Assert
    expect(error).toBeNull();
    expect(await existingHolds([released])).toEqual([]);
  });

  it('es idempotente: una segunda corrida con el mismo cutoff no borra nada', async () => {
    // Arrange
    await seedHold({ status: 'expired', createdAt: OLD() });
    const cutoff = HOLD_CUTOFF();
    await db.rpc('purge_stale_holds', { p_cutoff: cutoff });

    // Act
    const { data: second, error } = await db.rpc('purge_stale_holds', { p_cutoff: cutoff });

    // Assert
    expect(error).toBeNull();
    expect(second).toBe(0);
  });

  it('rechaza la llamada desde un rol público', async () => {
    // Arrange
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Act
    const { error } = await anon.rpc('purge_stale_holds', { p_cutoff: HOLD_CUTOFF() });

    // Assert
    expect(error?.code).toBe('42501');
  });
});

describe('apply-retention — orden de las purgas', () => {
  it('borra en la misma corrida el hold que purge_unpaid_bookings dejó sin reserva', async () => {
    // Arrange: reserva no pagada de hace 120 días sobre un hold liberado de la misma edad.
    const holdId = await seedHold({ status: 'released', createdAt: VERY_OLD() });
    const bookingId = await seedBooking(holdId, 'cancelled', VERY_OLD());

    // Act
    await applyRetention();

    // Assert
    const bookings = must(await db.from('bookings').select('id').eq('id', bookingId), 'booking');
    expect(bookings).toHaveLength(0);
    expect(await existingHolds([holdId])).toEqual([]);
  });
});

describe('purge_old_notifications', () => {
  it('conserva los envíos futuros y purga lo terminal o vencido de hace más de 90 días', async () => {
    // Arrange: una reserva, un tipo de notificación por caso (UNIQUE booking_id + kind).
    const bookingId = await seedBooking(null, 'confirmed');
    const seeds = {
      futureReminder: {
        kind: 'reminder_24h',
        status: 'pending',
        created_at: VERY_OLD(),
        scheduled_for: isoFromNow(10 * DAY_MS),
      },
      stalePending: {
        kind: 'booking_confirmation',
        status: 'pending',
        created_at: VERY_OLD(),
        scheduled_for: VERY_OLD(),
      },
      oldSent: {
        kind: 'cancellation_confirmation',
        status: 'sent',
        created_at: VERY_OLD(),
        scheduled_for: VERY_OLD(),
      },
      oldFailed: {
        kind: 'refund_confirmation',
        status: 'failed',
        created_at: VERY_OLD(),
        scheduled_for: VERY_OLD(),
      },
      oldCancelled: {
        kind: 'booking_reserved',
        status: 'cancelled',
        created_at: VERY_OLD(),
        scheduled_for: VERY_OLD(),
      },
      // Pendiente creada hace mucho pero con envío dentro de los 90 días: se evalúa por
      // scheduled_for, no por created_at.
      pendingRecentSchedule: {
        kind: 'departure_cancelled_minimum',
        status: 'pending',
        created_at: VERY_OLD(),
        scheduled_for: isoFromNow(-DAY_MS),
      },
      recentSent: {
        kind: 'overbooked_refunded',
        status: 'sent',
        created_at: isoFromNow(-DAY_MS),
        scheduled_for: isoFromNow(-DAY_MS),
      },
    } as const;
    ok(
      await db.from('notifications').insert(
        Object.values(seeds).map((seed) => ({
          ...seed,
          booking_id: bookingId,
          recipient_email: 'retencion@example.com',
          locale: 'es',
        })),
      ),
      'seed notifications',
    );

    // Act
    const { error } = await db.rpc('purge_old_notifications', { p_cutoff: NOTIFICATION_CUTOFF() });

    // Assert
    expect(error).toBeNull();
    const remaining = must(
      await db.from('notifications').select('kind').eq('booking_id', bookingId),
      'remaining',
    ).map((row) => row.kind);
    expect(remaining.sort()).toEqual(
      [seeds.futureReminder.kind, seeds.pendingRecentSchedule.kind, seeds.recentSent.kind].sort(),
    );
  });
});
