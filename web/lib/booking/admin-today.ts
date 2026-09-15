import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { BookingStatus } from '@shared/constants/enums';
import { operatorDayBoundsUtc } from './today-range';
import type { TodayInstance } from './admin-types';

// Salidas del día para el panel, con agregados de ocupación. Separado de admin-detail.ts (detalle
// de una reserva) por SRP y el límite de tamaño.

const TODAY_SELECT = `
  id, tour_id, starts_at, capacity_total,
  tours!inner ( name_es ),
  bookings ( status, tickets_adult, tickets_child, tickets_student, checked_in_at )
`;

interface RawTodayBooking {
  status: string;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
  checked_in_at: string | null;
}

interface RawTodayInstance {
  id: string;
  tour_id: string;
  starts_at: string;
  capacity_total: number;
  tours: { name_es: string } | null;
  bookings: RawTodayBooking[] | null;
}

function toTodayInstance(r: RawTodayInstance): TodayInstance {
  const bookings = r.bookings ?? [];
  let confirmedTickets = 0;
  let checkedInCount = 0;
  for (const b of bookings) {
    if (b.status !== BookingStatus.Confirmed) continue;
    confirmedTickets += b.tickets_adult + b.tickets_child + b.tickets_student;
    if (b.checked_in_at) checkedInCount += 1;
  }
  return {
    id: r.id,
    tourId: r.tour_id,
    tourName: r.tours?.name_es ?? '',
    startsAt: r.starts_at,
    capacityTotal: r.capacity_total,
    confirmedTickets,
    checkedInCount,
  };
}

export async function listTodayInstances(now?: Date): Promise<TodayInstance[]> {
  const supabase = await createSupabaseServerClient();
  const { startIso, endIso } = operatorDayBoundsUtc(now);
  const { data, error } = await supabase
    .from('tour_instances')
    .select(TODAY_SELECT)
    .gte('starts_at', startIso)
    .lt('starts_at', endIso)
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as unknown as RawTodayInstance[] | null) ?? []).map(toTodayInstance);
}
