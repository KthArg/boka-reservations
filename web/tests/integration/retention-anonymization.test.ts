// Retención y anonimización de PII (spec 0022, PRIV-02/03) — integración contra DB real.
// Verifica las 5 funciones SQL: anonimización por titular (con/sin pago, payment_mismatch,
// idempotencia, normalización de email, borrado de dependientes), las 4 funciones de
// retención automática, y los grants (anon/authenticated no pueden ejecutarlas).
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const PERMISSION_DENIED = '42501';
const ANON_NAME = 'ANONIMIZADO';
const ANON_EMAIL = 'anonimizado@anonimizado.local';
const DAY_MS = 24 * 60 * 60 * 1000;
const AMOUNT = 4000;

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_SLUG = `retention-${crypto.randomUUID().slice(0, 8)}`;
let tourId: string;
let scheduleId: string;
let instanceFuture: string; // starts_at +25h
let instancePast: string; //   starts_at -3 años
let adminUserId: string;
let guideUserId: string;
let staff: SupabaseClient;
const guideTokenHashes: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

async function makeBooking(opts: {
  email: string;
  instanceId?: string;
  status?: Database['public']['Tables']['bookings']['Row']['status'];
  paymentStatus?: 'pending' | 'succeeded' | 'failed' | 'refunded';
  createdAt?: string;
  name?: string;
}): Promise<string> {
  const { data, error } = await admin
    .from('bookings')
    .insert({
      tour_instance_id: opts.instanceId ?? instanceFuture,
      customer_name: opts.name ?? 'Test Person',
      customer_email: opts.email,
      tickets_adult: 1,
      total_amount_cents: AMOUNT,
      status: opts.status ?? 'confirmed',
      locale: 'es',
      ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
    })
    .select('id')
    .single();
  if (error) throw new Error(`makeBooking: ${error.message}`);
  const bookingId = data!.id;
  if (opts.paymentStatus) {
    await admin.from('payments').insert({
      booking_id: bookingId,
      external_payment_id: `pi_${crypto.randomUUID()}`,
      amount_cents: AMOUNT,
      status: opts.paymentStatus,
    });
  }
  return bookingId;
}

beforeAll(async () => {
  const { data: adminUser } = await admin
    .from('users')
    .select('id')
    .eq('email', 'admin@bokatrails.com')
    .single();
  adminUserId = adminUser!.id;

  const { data: guideUser } = await admin
    .from('users')
    .select('id')
    .eq('role', 'guide')
    .limit(1)
    .single();
  guideUserId = guideUser!.id;

  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'Tour Retencion',
      name_en: 'Retention Tour',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'P',
      meeting_point_en: 'P',
      includes_es: 'g',
      includes_en: 'g',
      min_participants: 1,
      max_capacity: 50,
    })
    .select('id')
    .single();
  tourId = tour!.id;

  const { data: sched } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 1, start_time: '08:00', capacity: 50 })
    .select('id')
    .single();
  scheduleId = sched!.id;

  const future = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 3 * 365 * DAY_MS).toISOString();
  const { data: instF } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: future,
      ends_at: future,
      capacity_total: 50,
    })
    .select('id')
    .single();
  instanceFuture = instF!.id;
  const { data: instP } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: scheduleId,
      starts_at: past,
      ends_at: past,
      capacity_total: 50,
    })
    .select('id')
    .single();
  instancePast = instP!.id;

  staff = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await staff.auth.signInWithPassword({
    email: 'staff@bokatrails.com',
    password: 'staff1234',
  });
  if (error) throw new Error(`signIn staff: ${error.message}`);
});

afterAll(async () => {
  for (const inst of [instanceFuture, instancePast]) {
    const { data: bks } = await admin.from('bookings').select('id').eq('tour_instance_id', inst);
    for (const b of bks ?? []) {
      await admin.from('refunds').delete().eq('booking_id', b.id);
      await admin.from('payments').delete().eq('booking_id', b.id);
    }
    await admin.from('bookings').delete().eq('tour_instance_id', inst);
  }
  if (guideTokenHashes.length > 0) {
    await admin.from('guide_access_tokens').delete().in('token_hash', guideTokenHashes);
  }
  await admin.from('tour_instances').delete().eq('tour_id', tourId);
  await admin.from('tour_schedules').delete().eq('tour_id', tourId);
  await admin.from('tours').delete().eq('id', tourId);
});

describe('anonymize_booking_pii_by_email (PRIV-02)', () => {
  it('anonimiza la reserva con pago, borra la abandonada y es idempotente', async () => {
    const email = uniqueEmail('erasure');
    const paidId = await makeBooking({ email, status: 'confirmed', paymentStatus: 'succeeded' });
    await admin.from('notifications').insert({
      booking_id: paidId,
      kind: 'booking_confirmation',
      recipient_email: email,
      locale: 'es',
      scheduled_for: new Date().toISOString(),
    });
    const unpaidId = await makeBooking({
      email,
      status: 'pending_payment',
      paymentStatus: 'pending',
    });

    const { data, error } = await admin.rpc('anonymize_booking_pii_by_email', {
      p_email: email,
      p_actor_id: adminUserId,
    });
    expect(error).toBeNull();
    expect(data![0]).toEqual({ anonymized_count: 1, deleted_count: 1 });

    const { data: paid } = await admin
      .from('bookings')
      .select('customer_name, customer_email, anonymized_at')
      .eq('id', paidId)
      .single();
    expect(paid!.customer_name).toBe(ANON_NAME);
    expect(paid!.customer_email).toBe(ANON_EMAIL);
    expect(paid!.anonymized_at).not.toBeNull();

    const { data: notif } = await admin
      .from('notifications')
      .select('recipient_email')
      .eq('booking_id', paidId)
      .single();
    expect(notif!.recipient_email).toBe(ANON_EMAIL);

    // El pago (registro contable) se conserva.
    const { data: pay } = await admin
      .from('payments')
      .select('amount_cents')
      .eq('booking_id', paidId);
    expect(pay).toHaveLength(1);
    expect(pay![0].amount_cents).toBe(AMOUNT);

    // La abandonada y su pago se borraron (FK: payments no cascadea).
    const { data: gone } = await admin.from('bookings').select('id').eq('id', unpaidId);
    expect(gone ?? []).toHaveLength(0);
    const { data: gonePay } = await admin.from('payments').select('id').eq('booking_id', unpaidId);
    expect(gonePay ?? []).toHaveLength(0);

    // Idempotencia: segunda corrida no toca nada.
    const { data: second } = await admin.rpc('anonymize_booking_pii_by_email', {
      p_email: email,
      p_actor_id: adminUserId,
    });
    expect(second![0]).toEqual({ anonymized_count: 0, deleted_count: 0 });
  });

  it('normaliza el email (trim + mayúsculas) antes de buscar', async () => {
    const email = uniqueEmail('Mixed.Case');
    await makeBooking({ email, status: 'confirmed', paymentStatus: 'succeeded' });

    const { data } = await admin.rpc('anonymize_booking_pii_by_email', {
      p_email: `  ${email.toUpperCase()}  `,
      p_actor_id: adminUserId,
    });
    expect(data![0].anonymized_count).toBe(1);
  });

  it('anonimiza (no borra) una reserva en payment_mismatch', async () => {
    const email = uniqueEmail('mismatch');
    const id = await makeBooking({ email, status: 'payment_mismatch', paymentStatus: 'pending' });

    const { data } = await admin.rpc('anonymize_booking_pii_by_email', {
      p_email: email,
      p_actor_id: adminUserId,
    });
    expect(data![0]).toEqual({ anonymized_count: 1, deleted_count: 0 });

    const { data: row } = await admin
      .from('bookings')
      .select('customer_name, status')
      .eq('id', id)
      .single();
    expect(row!.customer_name).toBe(ANON_NAME);
    expect(row!.status).toBe('payment_mismatch');
  });

  it('un email inexistente devuelve (0, 0)', async () => {
    const { data } = await admin.rpc('anonymize_booking_pii_by_email', {
      p_email: uniqueEmail('nobody'),
      p_actor_id: adminUserId,
    });
    expect(data![0]).toEqual({ anonymized_count: 0, deleted_count: 0 });
  });
});

describe('retención automática (PRIV-03)', () => {
  it('anonymize_bookings_past_retention anonimiza con pago según la fecha de salida', async () => {
    const emailPast = uniqueEmail('past');
    const emailFuture = uniqueEmail('future');
    const pastId = await makeBooking({
      email: emailPast,
      instanceId: instancePast,
      status: 'confirmed',
      paymentStatus: 'succeeded',
    });
    const futureId = await makeBooking({
      email: emailFuture,
      instanceId: instanceFuture,
      status: 'confirmed',
      paymentStatus: 'succeeded',
    });

    const cutoff = new Date(Date.now() - 2 * 365 * DAY_MS).toISOString();
    const { data, error } = await admin.rpc('anonymize_bookings_past_retention', {
      p_cutoff: cutoff,
    });
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(1);

    const { data: past } = await admin
      .from('bookings')
      .select('customer_name')
      .eq('id', pastId)
      .single();
    expect(past!.customer_name).toBe(ANON_NAME);

    const { data: fut } = await admin
      .from('bookings')
      .select('customer_name')
      .eq('id', futureId)
      .single();
    expect(fut!.customer_name).toBe('Test Person');
  });

  it('purge_unpaid_bookings borra abandonadas viejas y conserva recientes y payment_mismatch', async () => {
    const oldUnpaid = await makeBooking({
      email: uniqueEmail('old-unpaid'),
      status: 'pending_payment',
      paymentStatus: 'pending',
      createdAt: new Date(Date.now() - 400 * DAY_MS).toISOString(),
    });
    const recentUnpaid = await makeBooking({
      email: uniqueEmail('recent-unpaid'),
      status: 'pending_payment',
      paymentStatus: 'pending',
    });
    const oldMismatch = await makeBooking({
      email: uniqueEmail('old-mismatch'),
      status: 'payment_mismatch',
      paymentStatus: 'pending',
      createdAt: new Date(Date.now() - 400 * DAY_MS).toISOString(),
    });

    const cutoff = new Date(Date.now() - 300 * DAY_MS).toISOString();
    const { data, error } = await admin.rpc('purge_unpaid_bookings', { p_cutoff: cutoff });
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(1);

    const { data: gone } = await admin.from('bookings').select('id').eq('id', oldUnpaid);
    expect(gone ?? []).toHaveLength(0);
    const { data: recent } = await admin.from('bookings').select('id').eq('id', recentUnpaid);
    expect(recent ?? []).toHaveLength(1);
    const { data: mismatch } = await admin.from('bookings').select('id').eq('id', oldMismatch);
    expect(mismatch ?? []).toHaveLength(1);
  });

  it('purge_expired_access_tokens borra vencidos (booking + guide) y conserva vigentes', async () => {
    const bookingId = await makeBooking({ email: uniqueEmail('tok') });
    const expiredHash = `exp-${crypto.randomUUID()}`;
    const freshHash = `fresh-${crypto.randomUUID()}`;
    await admin.from('booking_access_tokens').insert([
      {
        booking_id: bookingId,
        token_hash: expiredHash,
        expires_at: new Date(Date.now() - 400 * DAY_MS).toISOString(),
      },
      {
        booking_id: bookingId,
        token_hash: freshHash,
        expires_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      },
    ]);
    const guideExpiredHash = `guide-exp-${crypto.randomUUID()}`;
    guideTokenHashes.push(guideExpiredHash);
    await admin.from('guide_access_tokens').insert({
      guide_id: guideUserId,
      token_hash: guideExpiredHash,
      expires_at: new Date(Date.now() - 400 * DAY_MS).toISOString(),
    });

    const cutoff = new Date(Date.now() - 300 * DAY_MS).toISOString();
    const { data, error } = await admin.rpc('purge_expired_access_tokens', { p_cutoff: cutoff });
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(2);

    const { data: bkExpired } = await admin
      .from('booking_access_tokens')
      .select('id')
      .eq('token_hash', expiredHash);
    expect(bkExpired ?? []).toHaveLength(0);
    const { data: bkFresh } = await admin
      .from('booking_access_tokens')
      .select('id')
      .eq('token_hash', freshHash);
    expect(bkFresh ?? []).toHaveLength(1);
    const { data: gdExpired } = await admin
      .from('guide_access_tokens')
      .select('id')
      .eq('token_hash', guideExpiredHash);
    expect(gdExpired ?? []).toHaveLength(0);
  });

  it('purge_old_notifications borra notificaciones viejas y conserva recientes', async () => {
    const bookingId = await makeBooking({ email: uniqueEmail('notif') });
    const { data: oldNotif } = await admin
      .from('notifications')
      .insert({
        booking_id: bookingId,
        kind: 'booking_confirmation',
        recipient_email: uniqueEmail('notif'),
        locale: 'es',
        scheduled_for: new Date().toISOString(),
        created_at: new Date(Date.now() - 400 * DAY_MS).toISOString(),
      })
      .select('id')
      .single();
    const { data: recentNotif } = await admin
      .from('notifications')
      .insert({
        booking_id: bookingId,
        kind: 'reminder_24h',
        recipient_email: uniqueEmail('notif'),
        locale: 'es',
        scheduled_for: new Date().toISOString(),
      })
      .select('id')
      .single();

    const cutoff = new Date(Date.now() - 300 * DAY_MS).toISOString();
    const { data, error } = await admin.rpc('purge_old_notifications', { p_cutoff: cutoff });
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(1);

    const { data: gone } = await admin.from('notifications').select('id').eq('id', oldNotif!.id);
    expect(gone ?? []).toHaveLength(0);
    const { data: kept } = await admin.from('notifications').select('id').eq('id', recentNotif!.id);
    expect(kept ?? []).toHaveLength(1);
  });
});

describe('grants — anon/authenticated no ejecutan las funciones de retención', () => {
  const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
  const cases: Array<[string, Record<string, unknown>]> = [
    ['anonymize_booking_pii_by_email', { p_email: 'x@x.com', p_actor_id: ZERO_UUID }],
    ['anonymize_bookings_past_retention', { p_cutoff: new Date().toISOString() }],
    ['purge_unpaid_bookings', { p_cutoff: new Date().toISOString() }],
    ['purge_expired_access_tokens', { p_cutoff: new Date().toISOString() }],
    ['purge_old_notifications', { p_cutoff: new Date().toISOString() }],
  ];

  it.each(cases)('anon NO puede ejecutar %s', async (fn, args) => {
    const { error } = await anon.rpc(fn, args);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(cases)('authenticated (staff) NO puede ejecutar %s', async (fn, args) => {
    const { error } = await staff.rpc(fn, args);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});
