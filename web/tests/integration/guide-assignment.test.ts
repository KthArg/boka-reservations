import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GuideAssignmentError } from '@shared/constants/guides';
import { NotificationKind } from '@shared/constants/notifications';
import { assignGuide, unassignGuide } from '@/lib/guides/assign-action';

// Mockeamos solo las fronteras del runtime de Next (auth + cache). La escritura
// en DB corre de verdad contra Postgres.
const requireAnyRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/server', () => ({ requireAnyRole: requireAnyRoleMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let admin: SupabaseClient;
let staffUserId: string;
let guideId: string;
let secondGuideId: string;
const createdTourIds: string[] = [];

async function seedInstance(): Promise<string> {
  const { data: tour } = await admin
    .from('tours')
    .insert({
      slug: `grd-${crypto.randomUUID()}`,
      name_es: 'Tour ES',
      name_en: 'Tour EN',
      description_es: 'd',
      description_en: 'd',
      difficulty: 'easy',
      duration_minutes: 60,
      meeting_point_es: 'm',
      meeting_point_en: 'm',
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
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      ends_at: new Date(Date.now() + 90_000_000).toISOString(),
      capacity_total: 10,
    })
    .select('id')
    .single();

  return instance!.id;
}

async function countAssignmentNotifs(instanceId: string, gId: string): Promise<number> {
  const { count } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('tour_instance_id', instanceId)
    .eq('guide_id', gId)
    .eq('kind', NotificationKind.GuideAssignment);
  return count ?? 0;
}

describe('assignGuide / unassignGuide (server action, integration)', () => {
  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: staff } = await admin
      .from('users')
      .select('id')
      .eq('role', 'staff')
      .limit(1)
      .single();
    staffUserId = staff!.id;

    const { data: guides } = await admin.from('users').select('id').eq('role', 'guide');
    guideId = guides![0].id;
    // Segundo guía: reutiliza el admin como destino alternativo no es válido
    // (no es guide). Creamos uno efímero con role guide.
    const { data: g2 } = await admin
      .from('users')
      .insert({
        email: `guide-${crypto.randomUUID()}@example.com`,
        role: 'guide',
        full_name: 'Guía Dos',
        phone: '+506 8000-0000',
      })
      .select('id')
      .single();
    secondGuideId = g2!.id;
  });

  afterEach(async () => {
    requireAnyRoleMock.mockReset();
    while (createdTourIds.length) {
      const tourId = createdTourIds.pop()!;
      await admin.from('tours').delete().eq('id', tourId); // cascada limpia instancias, asignaciones y notifs
    }
  });

  afterAll(async () => {
    await admin.from('users').delete().eq('id', secondGuideId);
  });

  it('asigna un guía: crea la fila puente y encola el email una vez', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });
    const instanceId = await seedInstance();

    const result = await assignGuide(instanceId, guideId);

    expect(result).toEqual({ ok: true });
    const { data: link } = await admin
      .from('tour_instance_guides')
      .select('guide_id, assigned_by')
      .eq('tour_instance_id', instanceId)
      .single();
    expect(link!.guide_id).toBe(guideId);
    expect(link!.assigned_by).toBe(staffUserId);
    expect(await countAssignmentNotifs(instanceId, guideId)).toBe(1);
  });

  it('reasignar el mismo guía no encola un segundo email (idempotente)', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });
    const instanceId = await seedInstance();

    await assignGuide(instanceId, guideId);
    await assignGuide(instanceId, guideId);

    expect(await countAssignmentNotifs(instanceId, guideId)).toBe(1);
  });

  it('reasignar a otro guía reemplaza la asignación y notifica al nuevo', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });
    const instanceId = await seedInstance();

    await assignGuide(instanceId, guideId);
    await assignGuide(instanceId, secondGuideId);

    const { data: links } = await admin
      .from('tour_instance_guides')
      .select('guide_id')
      .eq('tour_instance_id', instanceId);
    expect(links).toHaveLength(1);
    expect(links![0].guide_id).toBe(secondGuideId);
    expect(await countAssignmentNotifs(instanceId, secondGuideId)).toBe(1);
  });

  it('rechaza asignar a un usuario que no es guía', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });
    const instanceId = await seedInstance();

    const result = await assignGuide(instanceId, staffUserId);

    expect(result).toEqual({ ok: false, error: GuideAssignmentError.NotAGuide });
    const { count } = await admin
      .from('tour_instance_guides')
      .select('guide_id', { count: 'exact', head: true })
      .eq('tour_instance_id', instanceId);
    expect(count).toBe(0);
  });

  it('rechaza si la instancia no existe', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });
    const result = await assignGuide(crypto.randomUUID(), guideId);
    expect(result).toEqual({ ok: false, error: GuideAssignmentError.InstanceNotFound });
  });

  it('rechaza si el usuario no tiene rol admin/staff', async () => {
    requireAnyRoleMock.mockRejectedValue(new Error('UNAUTHORIZED'));
    const instanceId = await seedInstance();

    const result = await assignGuide(instanceId, guideId);

    expect(result).toEqual({ ok: false, error: GuideAssignmentError.Unauthorized });
  });

  it('unassignGuide quita la fila puente', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId });
    const instanceId = await seedInstance();
    await assignGuide(instanceId, guideId);

    const result = await unassignGuide(instanceId);

    expect(result).toEqual({ ok: true });
    const { count } = await admin
      .from('tour_instance_guides')
      .select('guide_id', { count: 'exact', head: true })
      .eq('tour_instance_id', instanceId);
    expect(count).toBe(0);
  });
});
