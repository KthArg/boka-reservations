import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { ADMIN_BOOKINGS_PAGE_SIZE } from '@shared/constants/bookings';
import type { BookingFilters, AdminBookingRow, AdminBookingPage } from './admin-types';

const LIST_SELECT = `
  id, customer_name, status, checked_in_at,
  tickets_adult, tickets_child, tickets_student,
  tour_instances!inner ( starts_at, tour_id, tours!inner ( name_es ) ),
  payments ( status )
`;

interface RawListRow {
  id: string;
  customer_name: string;
  status: string;
  checked_in_at: string | null;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
  tour_instances: { starts_at: string; tours: { name_es: string } | null } | null;
  payments: { status: string }[] | null;
}

// El cliente está tipado con Database, pero los filtros sobre tablas embebidas
// (tour_instances.tour_id, etc.) no encajan en keyof Row del query builder
// generado. Usamos un tipo laxo para la cadena de filtros; los resultados se
// re-tipan explícitamente vía RawListRow/RawExportRow al mapear.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder de PostgREST sobre columnas embebidas
export type FilterBuilder = any;

const startOfDay = (d: string) => `${d}T00:00:00Z`;
const FIRST_PAGE = 1;
const endOfDay = (d: string) => `${d}T23:59:59.999Z`;
const sanitizeSearch = (s: string) => s.replace(/[,()*\\]/g, '');

function toRow(r: RawListRow): AdminBookingRow {
  return {
    id: r.id,
    startsAt: r.tour_instances?.starts_at ?? '',
    tourName: r.tour_instances?.tours?.name_es ?? '',
    customerName: r.customer_name,
    totalTickets: r.tickets_adult + r.tickets_child + r.tickets_student,
    status: r.status,
    paymentStatus: r.payments?.[0]?.status ?? null,
    checkedInAt: r.checked_in_at,
  };
}

export function applyFilters(query: FilterBuilder, filters: BookingFilters): FilterBuilder {
  let q = query;
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.tourId) q = q.eq('tour_instances.tour_id', filters.tourId);
  if (filters.dateFrom) q = q.gte('tour_instances.starts_at', startOfDay(filters.dateFrom));
  if (filters.dateTo) q = q.lte('tour_instances.starts_at', endOfDay(filters.dateTo));
  if (filters.search) {
    const s = sanitizeSearch(filters.search);
    q = q.or(`customer_name.ilike.%${s}%,customer_email.ilike.%${s}%`);
  }
  return q;
}

export const ordered = (q: FilterBuilder): FilterBuilder =>
  q.order('starts_at', { referencedTable: 'tour_instances', ascending: true });

/**
 * Construye el query builder de bookings con el select dado.
 *
 * IMPORTANTE: esta función NO puede ser `async` retornando el builder. El
 * filter builder de PostgREST es thenable, y una función async que retorna un
 * thenable lo desenvuelve al await-earla — devolvería el resultado de la query
 * en vez del builder, y la cadena `.eq()/.order()/.range()` rompería con
 * "q.order is not a function". Por eso recibe el cliente ya resuelto.
 */
export function buildBookingsQuery(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  select: string,
  withCount: boolean,
): FilterBuilder {
  const table = supabase.from('bookings');
  return withCount ? table.select(select, { count: 'exact' }) : table.select(select);
}

export async function listBookingsForAdmin(filters: BookingFilters): Promise<AdminBookingPage> {
  const supabase = await createSupabaseServerClient();
  const base = buildBookingsQuery(supabase, LIST_SELECT, true);
  const from = (filters.page - FIRST_PAGE) * ADMIN_BOOKINGS_PAGE_SIZE;
  const to = from + ADMIN_BOOKINGS_PAGE_SIZE - 1;

  const { data, count, error } = await ordered(applyFilters(base, filters)).range(from, to);
  if (error) throw new Error(error.message);

  const rows = ((data as RawListRow[] | null) ?? []).map(toRow);
  return { rows, total: count ?? 0 };
}
