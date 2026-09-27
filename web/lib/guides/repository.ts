import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { BookingStatus, InstanceStatus, UserRole } from '@shared/constants/enums';
import { DepartureChargeState, type AssignableGuide, type Departure } from './types';

type RawBooking = {
  status: string;
  authorized_at: string | null;
  cancel_claimed_at: string | null;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
};

type RawAssignment = { users: { id: string; full_name: string } | null };

type RawDeparture = {
  id: string;
  starts_at: string;
  capacity_total: number;
  minimum_charge_triggered_at: string | null;
  minimum_charge_closed_at: string | null;
  minimum_resolved_at: string | null;
  minimum_resolution: string | null;
  staff_decision_required_at: string | null;
  min_participants_at_trigger: number | null;
  tours: { name_es: string; min_participants: number } | null;
  tour_instance_guides: RawAssignment[] | null;
  bookings: RawBooking[] | null;
};

// tour_instance_guides tiene DOS FKs a users (guide_id y assigned_by); hay que
// desambiguar el embed con el hint de la FK, si no PostgREST falla con
// "more than one relationship was found".
const DEPARTURES_SELECT = `
  id, starts_at, capacity_total,
  minimum_charge_triggered_at, minimum_charge_closed_at, minimum_resolved_at,
  minimum_resolution, staff_decision_required_at, min_participants_at_trigger,
  tours!inner ( name_es, min_participants ),
  tour_instance_guides ( users!guide_id ( id, full_name ) ),
  bookings (
    status, authorized_at, cancel_claimed_at, tickets_adult, tickets_child, tickets_student
  )
`;

function confirmedTickets(bookings: RawBooking[] | null): number {
  return (bookings ?? [])
    .filter((b) => b.status === BookingStatus.Confirmed)
    .reduce((s, b) => s + ticketsOf(b), 0);
}

function ticketsOf(b: RawBooking): number {
  return b.tickets_adult + b.tickets_child + b.tickets_student;
}

/** Cupos con la plata retenida o ya cobrada: es lo que el mínimo mide al decidir (spec 0033). */
function authorizedTickets(bookings: RawBooking[] | null): number {
  return (bookings ?? [])
    .filter(
      (b) =>
        b.status === BookingStatus.Confirmed ||
        // Mismo criterio que departure_seat_counts: una reserva con la cancelación reclamada no
        // cuenta, o el staff confirmaría una salida creyendo que llegó al mínimo.
        (b.status === BookingStatus.PendingPayment &&
          b.authorized_at !== null &&
          b.cancel_claimed_at === null),
    )
    .reduce((s, b) => s + ticketsOf(b), 0);
}

/**
 * El estado del cobro se deriva de las columnas del ciclo, no de una columna propia: el disparo
 * es evidencia de que hubo un ciclo, y lo que manda es si ya se resolvió y si el plazo venció.
 */
function toCharge(r: RawDeparture, now: Date): Departure['charge'] {
  const deadline = r.staff_decision_required_at;
  const base = {
    authorizedTickets: authorizedTickets(r.bookings),
    minimum: r.min_participants_at_trigger ?? r.tours?.min_participants ?? 0,
    deadline,
    resolution: r.minimum_resolution,
  };
  if (r.minimum_resolved_at !== null) return { ...base, state: DepartureChargeState.Resolved };
  if (r.minimum_charge_triggered_at === null || r.minimum_charge_closed_at !== null) {
    return { ...base, state: DepartureChargeState.Idle };
  }
  const expired = deadline !== null && new Date(deadline) <= now;
  return {
    ...base,
    state: expired ? DepartureChargeState.AwaitingDecision : DepartureChargeState.Charging,
  };
}

function toGuide(users: { id: string; full_name: string } | null): AssignableGuide | null {
  return users ? { id: users.id, fullName: users.full_name } : null;
}

function toDeparture(r: RawDeparture, now: Date): Departure {
  return {
    id: r.id,
    tourName: r.tours?.name_es ?? '',
    startsAt: r.starts_at,
    capacityTotal: r.capacity_total,
    confirmedTickets: confirmedTickets(r.bookings),
    assignedGuide: toGuide(r.tour_instance_guides?.[0]?.users ?? null),
    charge: toCharge(r, now),
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
  const at = now ?? new Date();
  const nowIso = at.toISOString();
  const { data, error } = await sb
    .from('tour_instances')
    .select(DEPARTURES_SELECT)
    .gte('starts_at', nowIso)
    .neq('status', InstanceStatus.Cancelled)
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as unknown as RawDeparture[] | null) ?? []).map((r) => toDeparture(r, at));
}
