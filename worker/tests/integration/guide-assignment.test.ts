// Job send-notifications — despacho del email de asignación al guía (spec 0009)
// Requiere: supabase start (Docker Desktop) + Mailpit en 54324/54325
// Ejecutar: pnpm --filter worker test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendNotifications } from '../../src/jobs/send-notifications.js';
import type { Database } from '../../../web/types/database.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const MAILPIT_API = 'http://127.0.0.1:54324/api/v1';
const DAY_MS = 86_400_000;

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
const TEST_SLUG = `guide-job-${crypto.randomUUID().slice(0, 8)}`;

let tourId: string;
let instanceId: string;
let guideId: string;
const guideEmail = `guide-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' }).catch(() => undefined);
}

async function listMailpitMessages(): Promise<
  Array<{ Subject: string; To: Array<{ Address: string }> }>
> {
  const res = await fetch(`${MAILPIT_API}/messages`);
  const json = (await res.json()) as {
    messages: Array<{ Subject: string; To: Array<{ Address: string }> }>;
  };
  return json.messages ?? [];
}

beforeAll(async () => {
  const { data: guide } = await admin
    .from('users')
    .insert({ email: guideEmail, role: 'guide', full_name: 'Guía Job', phone: '+506 8000-0001' })
    .select('id')
    .single();
  guideId = guide!.id;

  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: TEST_SLUG,
      name_es: 'Tour guía job',
      name_en: 'Guide job tour',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'Plaza ES',
      meeting_point_en: 'Plaza EN',
      includes_es: 'g',
      includes_en: 'g',
      min_participants: 1,
      max_capacity: 5,
      status: 'active',
    })
    .select('id')
    .single();
  tourId = tour!.id;

  const { data: sched } = await admin
    .from('tour_schedules')
    .insert({ tour_id: tourId, day_of_week: 1, start_time: '08:00', capacity: 5 })
    .select('id')
    .single();

  const startsAt = new Date(Date.now() + 2 * DAY_MS).toISOString();
  const { data: inst } = await admin
    .from('tour_instances')
    .insert({
      tour_id: tourId,
      schedule_id: sched!.id,
      starts_at: startsAt,
      ends_at: startsAt,
      capacity_total: 5,
    })
    .select('id')
    .single();
  instanceId = inst!.id;

  await admin
    .from('tour_instance_guides')
    .insert({ tour_instance_id: instanceId, guide_id: guideId });
});

afterAll(async () => {
  await admin.from('tours').delete().eq('id', tourId); // cascada: instancia, asignación, notifs
  await admin.from('guide_access_tokens').delete().eq('guide_id', guideId);
  await admin.from('users').delete().eq('id', guideId);
});

beforeEach(async () => {
  await clearMailpit();
});

describe('sendNotifications — guide_assignment (integración)', () => {
  it('despacha el email al guía, genera el token y marca sent', async () => {
    const { data: notif } = await admin
      .from('notifications')
      .insert({
        kind: 'guide_assignment',
        tour_instance_id: instanceId,
        guide_id: guideId,
        recipient_email: guideEmail,
        locale: 'es',
        scheduled_for: new Date().toISOString(),
      })
      .select('id')
      .single();

    await sendNotifications();

    const messages = await listMailpitMessages();
    const found = messages.find((m) => m.To.some((t) => t.Address === guideEmail));
    expect(found).toBeDefined();
    expect(found!.Subject).toMatch(/asignaron/i);

    const { data: sent } = await admin
      .from('notifications')
      .select('status, provider')
      .eq('id', notif!.id)
      .single();
    expect(sent!.status).toBe('sent');
    expect(sent!.provider).toBe('mailpit');

    const { count } = await admin
      .from('guide_access_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('guide_id', guideId);
    expect(count).toBe(1);
  });
});
