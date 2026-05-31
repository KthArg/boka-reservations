import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { applyFilters, ordered, buildBookingsQuery } from './repository';
import type { BookingFilters, AdminExportRow } from './admin-types';

const EXPORT_SELECT = `
  id, customer_name, customer_email, status, checked_in_at, created_at,
  tickets_adult, tickets_child, tickets_student, total_amount_cents, currency,
  tour_instances!inner ( starts_at, tour_id, tours!inner ( name_es ) ),
  payments ( status )
`;

interface RawExportRow {
  id: string;
  customer_name: string;
  customer_email: string;
  status: string;
  checked_in_at: string | null;
  created_at: string;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
  total_amount_cents: number;
  currency: string;
  tour_instances: { starts_at: string; tours: { name_es: string } | null } | null;
  payments: { status: string }[] | null;
}

function toExportRow(r: RawExportRow): AdminExportRow {
  return {
    id: r.id,
    tourName: r.tour_instances?.tours?.name_es ?? '',
    startsAt: r.tour_instances?.starts_at ?? '',
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    ticketsAdult: r.tickets_adult,
    ticketsChild: r.tickets_child,
    ticketsStudent: r.tickets_student,
    totalTickets: r.tickets_adult + r.tickets_child + r.tickets_student,
    status: r.status,
    paymentStatus: r.payments?.[0]?.status ?? null,
    totalAmountCents: r.total_amount_cents,
    currency: r.currency,
    checkedInAt: r.checked_in_at,
    createdAt: r.created_at,
  };
}

/** Reservas que matchean los filtros, sin paginar, para el export CSV. */
export async function listBookingsForExport(filters: BookingFilters): Promise<AdminExportRow[]> {
  const supabase = await createSupabaseServerClient();
  const base = buildBookingsQuery(supabase, EXPORT_SELECT, false);
  const { data, error } = await ordered(applyFilters(base, filters));
  if (error) throw new Error(error.message);
  return ((data as RawExportRow[] | null) ?? []).map(toExportRow);
}
