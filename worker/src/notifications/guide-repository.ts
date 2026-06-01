import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationRow } from './repository.js';

/** Datos crudos para renderizar el email de asignación al guía. */
export type GuideAssignmentData = {
  guideName: string;
  tourNameEs: string;
  tourNameEn: string;
  meetingPointEs: string;
  meetingPointEn: string;
  startsAt: string;
  passengerCount: number;
};

type InstanceRow = {
  starts_at: string;
  tours: {
    name_es: string;
    name_en: string;
    meeting_point_es: string;
    meeting_point_en: string;
  };
};

type TicketRow = { tickets_adult: number; tickets_child: number; tickets_student: number };

function sumPassengers(rows: TicketRow[]): number {
  return rows.reduce((s, r) => s + r.tickets_adult + r.tickets_child + r.tickets_student, 0);
}

/**
 * Carga la salida, el guía y el conteo de pasajeros confirmados para una
 * notificación `guide_assignment`. Devuelve null si la instancia o el guía
 * ya no existen (la notificación se cancela aguas arriba).
 */
export async function loadGuideAssignment(
  db: SupabaseClient,
  notif: NotificationRow,
): Promise<GuideAssignmentData | null> {
  if (!notif.tour_instance_id || !notif.guide_id) return null;

  const { data: instance, error: instErr } = await db
    .from('tour_instances')
    .select('starts_at, tours!inner(name_es, name_en, meeting_point_es, meeting_point_en)')
    .eq('id', notif.tour_instance_id)
    .maybeSingle<InstanceRow>();
  if (instErr) throw new Error(`load instance: ${instErr.message}`);
  if (!instance) return null;

  const { data: guide, error: guideErr } = await db
    .from('users')
    .select('full_name')
    .eq('id', notif.guide_id)
    .maybeSingle<{ full_name: string }>();
  if (guideErr) throw new Error(`load guide: ${guideErr.message}`);
  if (!guide) return null;

  const { data: tickets, error: ticketsErr } = await db
    .from('bookings')
    .select('tickets_adult, tickets_child, tickets_student')
    .eq('tour_instance_id', notif.tour_instance_id)
    .eq('status', 'confirmed');
  if (ticketsErr) throw new Error(`load passengers: ${ticketsErr.message}`);

  return {
    guideName: guide.full_name,
    tourNameEs: instance.tours.name_es,
    tourNameEn: instance.tours.name_en,
    meetingPointEs: instance.tours.meeting_point_es,
    meetingPointEn: instance.tours.meeting_point_en,
    startsAt: instance.starts_at,
    passengerCount: sumPassengers(tickets ?? []),
  };
}
