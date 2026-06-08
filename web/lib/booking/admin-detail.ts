import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { BookingStatus } from '@shared/constants/enums';
import { operatorDayBoundsUtc } from './today-range';
import type { AdminBookingDetail, TodayInstance } from './admin-types';

const DETAIL_SELECT = `
  id, customer_name, customer_email,
  tickets_adult, tickets_child, tickets_student,
  total_amount_cents, currency, status, checked_in_at, created_at, updated_at,
  tour_instances!inner ( starts_at, ends_at, tours!inner ( name_es ) ),
  payments ( status, external_provider ),
  notifications ( kind, status, sent_at ),
  refunds ( id, status, failure_reason )
`;

const TODAY_SELECT = `
  id, tour_id, starts_at, capacity_total,
  tours!inner ( name_es ),
  bookings ( status, tickets_adult, tickets_child, tickets_student, checked_in_at )
`;

interface RawDetail {
  id: string;
  customer_name: string;
  customer_email: string;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
  total_amount_cents: number;
  currency: string;
  status: string;
  checked_in_at: string | null;
  created_at: string;
  updated_at: string;
  tour_instances: { starts_at: string; ends_at: string; tours: { name_es: string } | null } | null;
  payments: { status: string; external_provider: string }[] | null;
  notifications: { kind: string; status: string; sent_at: string | null }[] | null;
  refunds: { id: string; status: string; failure_reason: string | null }[] | null;
}

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

function toDetail(r: RawDetail): AdminBookingDetail {
  return {
    id: r.id,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    tourName: r.tour_instances?.tours?.name_es ?? '',
    startsAt: r.tour_instances?.starts_at ?? '',
    endsAt: r.tour_instances?.ends_at ?? '',
    ticketsAdult: r.tickets_adult,
    ticketsChild: r.tickets_child,
    ticketsStudent: r.tickets_student,
    totalAmountCents: r.total_amount_cents,
    currency: r.currency,
    status: r.status,
    checkedInAt: r.checked_in_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    paymentStatus: r.payments?.[0]?.status ?? null,
    paymentProvider: r.payments?.[0]?.external_provider ?? null,
    notifications: (r.notifications ?? []).map((n) => ({
      kind: n.kind,
      status: n.status,
      sentAt: n.sent_at,
    })),
    refund: r.refunds?.[0]
      ? {
          id: r.refunds[0].id,
          status: r.refunds[0].status,
          failureReason: r.refunds[0].failure_reason,
        }
      : null,
  };
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

export async function getBookingDetailForAdmin(id: string): Promise<AdminBookingDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toDetail(data as unknown as RawDetail) : null;
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
