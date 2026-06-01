import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// guide-view.ts y token.ts llevan `import 'server-only'`, paquete que no existe
// en el runtime de vitest. Lo stubbeamos (mismo patrón que bookings-repository).
vi.mock('server-only', () => ({}));

const { getGuideUpcomingTours } = await import('@/lib/guides/guide-view');
const { hashGuideToken } = await import('@/lib/guides/hash');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DAY_MS = 86_400_000;

let admin: SupabaseClient;
let guideId: string;
const createdTourIds: string[] = [];
const createdTokenHashes: string[] = [];

async function seedAssignedInstance(startsAt: string, status = 'available'): Promise<string> {
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: `gv-${crypto.randomUUID()}`,
      name_es: 'Catarata ES',
      name_en: 'Waterfall EN',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'Punto ES',
      meeting_point_en: 'Point EN',
      includes_es: 'i',
      includes_en: 'i',
      min_participants: 1,
      max_capacity: 10,
    })
    .select('id')
    .single();
  createdTourIds.push(tour!.id);

  const { data: schedule } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tour!.id, day_of_week: 1, start_time: '09:00:00', capacity: 10 })
    .select('id')
    .single();

  const { data: instance } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tour!.id,
      schedule_id: schedule!.id,
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(),
      capacity_total: 10,
      status,
    })
    .select('id')
    .single();

  await admin
    .from('tour_instance_guides')
    .insert({ tour_instance_id: instance!.id, guide_id: guideId });

  return instance!.id;
}

async function issueToken(plaintext: string, expiresAt: string): Promise<void> {
  const tokenHash = hashGuideToken(plaintext);
  createdTokenHashes.push(tokenHash);
  await admin
    .from('guide_access_tokens')
    .insert({ guide_id: guideId, token_hash: tokenHash, expires_at: expiresAt });
}

describe('getGuideUpcomingTours (integration)', () => {
  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Guía efímero propio: el aserto cuenta TODAS las salidas asignadas al guía,
    // así que usar el guía del seed (compartido) volvería el test frágil ante
    // cualquier asignación residual de otras corridas. Con un guía dedicado, su
    // estado global es siempre el que siembra este test.
    const { data: guide } = await admin
      .from('users')
      .insert({
        email: `gv-guide-${crypto.randomUUID()}@example.com`,
        role: 'guide',
        full_name: 'Guía Vista',
        phone: '+506 8000-0002',
      })
      .select('id')
      .single();
    guideId = guide!.id;
  });

  afterAll(async () => {
    await admin.from('users').delete().eq('id', guideId);
  });

  afterEach(async () => {
    while (createdTourIds.length) {
      await admin.from('tours').delete().eq('id', createdTourIds.pop()!);
    }
    while (createdTokenHashes.length) {
      await admin.from('guide_access_tokens').delete().eq('token_hash', createdTokenHashes.pop()!);
    }
  });

  it('con token válido devuelve solo salidas futuras no canceladas con conteo', async () => {
    const future = new Date(Date.now() + 2 * DAY_MS).toISOString();
    const past = new Date(Date.now() - DAY_MS).toISOString();
    const futureInstanceId = await seedAssignedInstance(future);
    await seedAssignedInstance(past); // pasada: no debe aparecer
    await seedAssignedInstance(new Date(Date.now() + 3 * DAY_MS).toISOString(), 'cancelled');

    // Dos pasajeros confirmados en la instancia futura.
    await admin.from('bookings').insert({
      tour_instance_id: futureInstanceId,
      customer_name: 'C',
      customer_email: 'c@example.com',
      tickets_adult: 2,
      total_amount_cents: 5000,
      status: 'confirmed',
    });

    await issueToken('valid-token', new Date(Date.now() + 10 * DAY_MS).toISOString());

    const tours = await getGuideUpcomingTours('valid-token', 'es');

    expect(tours).not.toBeNull();
    expect(tours).toHaveLength(1);
    expect(tours![0].instanceId).toBe(futureInstanceId);
    expect(tours![0].tourName).toBe('Catarata ES');
    expect(tours![0].meetingPoint).toBe('Punto ES');
    expect(tours![0].passengerCount).toBe(2);
  });

  it('respeta el locale en nombre y punto de encuentro', async () => {
    await seedAssignedInstance(new Date(Date.now() + 2 * DAY_MS).toISOString());
    await issueToken('en-token', new Date(Date.now() + 10 * DAY_MS).toISOString());

    const tours = await getGuideUpcomingTours('en-token', 'en');

    expect(tours![0].tourName).toBe('Waterfall EN');
    expect(tours![0].meetingPoint).toBe('Point EN');
  });

  it('con token expirado devuelve null', async () => {
    await seedAssignedInstance(new Date(Date.now() + 2 * DAY_MS).toISOString());
    await issueToken('expired-token', new Date(Date.now() - DAY_MS).toISOString());

    const tours = await getGuideUpcomingTours('expired-token', 'es');

    expect(tours).toBeNull();
  });

  it('con token inexistente devuelve null', async () => {
    const tours = await getGuideUpcomingTours('no-such-token', 'es');
    expect(tours).toBeNull();
  });
});
