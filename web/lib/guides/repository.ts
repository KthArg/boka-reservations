import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { BookingStatus, InstanceStatus, UserRole } from '@shared/constants/enums';
import type { AssignableGuide, Departure } from './types';

type RawBooking = {
  status: string;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
};

type RawAssignment = { users: { id: string; full_name: string } | null };

type RawDeparture = {
  id: string;
  starts_at: string;
  capacity_total: number;
  tours: { name_es: string } | null;
  tour_instance_guides: RawAssignment[] | null;
  bookings: RawBooking[] | null;
};

// tour_instance_guides tiene DOS FKs a users (guide_id y assigned_by); hay que
// desambiguar el embed con el hint de la FK, si no PostgREST falla con
// "more than one relationship was found".
const DEPARTURES_SELECT = `
  id, starts_at, capacity_total,
  tours!inner ( name_es ),
  tour_instance_guides ( users!guide_id ( id, full_name ) ),
  bookings ( status, tickets_adult, tickets_child, tickets_student )
`;

function confirmedTickets(bookings: RawBooking[] | null): number {
  return (bookings ?? [])
    .filter((b) => b.status === BookingStatus.Confirmed)
    .reduce((s, b) => s + b.tickets_adult + b.tickets_child + b.tickets_student, 0);
}

function toGuide(users: { id: string; full_name: string } | null): AssignableGuide | null {
  return users ? { id: users.id, fullName: users.full_name } : null;
}

function toDeparture(r: RawDeparture): Departure {
  return {
    id: r.id,
    tourName: r.tours?.name_es ?? '',
    startsAt: r.starts_at,
    capacityTotal: r.capacity_total,
    confirmedTickets: confirmedTickets(r.bookings),
    assignedGuide: toGuide(r.tour_instance_guides?.[0]?.users ?? null),
  };
}

/** Usuarios con role='guide' activos, ordenados por nombre. */
export async function listGuides(): Promise<AssignableGuide[]> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from('users')
    .select('id, full_name')
    .eq('role', UserRole.Guide)
    .eq('active', true)
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((u) => ({ id: u.id, fullName: u.full_name }));
}

/** Salidas futuras (no canceladas) con su guía asignado y tiquetes confirmados. */
export async function listUpcomingDepartures(now?: Date): Promise<Departure[]> {
  const sb = await createSupabaseServerClient();
  const nowIso = (now ?? new Date()).toISOString();
  const { data, error } = await sb
    .from('tour_instances')
    .select(DEPARTURES_SELECT)
    .gte('starts_at', nowIso)
    .neq('status', InstanceStatus.Cancelled)
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as unknown as RawDeparture[] | null) ?? []).map(toDeparture);
}
