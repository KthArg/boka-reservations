import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { BookingStatus, InstanceStatus } from '@shared/constants/enums';
import { validateGuideToken } from './token';
import type { GuideUpcomingTour, Locale } from './types';

type RawBooking = {
  status: string;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
};

type RawInstance = {
  id: string;
  starts_at: string;
  status: string;
  tours: {
    name_es: string;
    name_en: string;
    meeting_point_es: string;
    meeting_point_en: string;
  } | null;
  bookings: RawBooking[] | null;
};

type RawAssignedRow = { tour_instances: RawInstance | null };

const ASSIGNED_SELECT = `
  tour_instances!inner (
    id, starts_at, status,
    tours!inner ( name_es, name_en, meeting_point_es, meeting_point_en ),
    bookings ( status, tickets_adult, tickets_child, tickets_student )
  )
`;

function passengerCount(bookings: RawBooking[] | null): number {
  return (bookings ?? [])
    .filter((b) => b.status === BookingStatus.Confirmed)
    .reduce((s, b) => s + b.tickets_adult + b.tickets_child + b.tickets_student, 0);
}

function toUpcoming(inst: RawInstance, locale: Locale): GuideUpcomingTour {
  return {
    instanceId: inst.id,
    tourName: locale === 'es' ? (inst.tours?.name_es ?? '') : (inst.tours?.name_en ?? ''),
    startsAt: inst.starts_at,
    meetingPoint:
      locale === 'es' ? (inst.tours?.meeting_point_es ?? '') : (inst.tours?.meeting_point_en ?? ''),
    passengerCount: passengerCount(inst.bookings),
  };
}

/**
 * Salidas futuras (no canceladas) asignadas al guía dueño del token.
 * Devuelve null si el token es inválido o expiró (la página muestra el
 * mensaje de enlace inválido sin filtrar datos).
 */
export async function getGuideUpcomingTours(
  token: string,
  locale: Locale,
): Promise<GuideUpcomingTour[] | null> {
  const db = createSupabaseServiceClient();
  const guideId = await validateGuideToken(db, token);
  if (!guideId) return null;

  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from('tour_instance_guides')
    .select(ASSIGNED_SELECT)
    .eq('guide_id', guideId);
  if (error) throw new Error(error.message);

  return ((data as unknown as RawAssignedRow[] | null) ?? [])
    .map((r) => r.tour_instances)
    .filter((inst): inst is RawInstance => inst !== null)
    .filter((inst) => inst.status !== InstanceStatus.Cancelled && inst.starts_at >= nowIso)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((inst) => toUpcoming(inst, locale));
}
