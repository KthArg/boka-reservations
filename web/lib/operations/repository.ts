import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { InstanceStatus } from '@shared/constants/enums';
import type { DepartureCancellationReasonValue } from '@shared/constants/operations';
import { RefundStatus } from '@shared/constants/refunds';
import { selectRefundsToResolve, type RefundToResolve, type RefundTrayRow } from './refund-tray';

// Lecturas del panel para el spec 0035, con la sesión del staff (RLS de admin y staff).

export type ReviewBooking = {
  id: string;
  customerName: string;
  tourName: string;
  startsAt: string;
  reason: DepartureCancellationReasonValue | null;
  totalAmountCents: number;
  currency: string;
};

type RawReview = {
  id: string;
  customer_name: string;
  total_amount_cents: number;
  currency: string;
  tour_instances: {
    starts_at: string;
    cancellation_reason: DepartureCancellationReasonValue | null;
    tours: { name_es: string } | null;
  } | null;
};

/** Reservas cobradas de salidas canceladas por clima o seguridad, a la espera de una decisión. */
export async function listReviewBookings(): Promise<ReviewBooking[]> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from('bookings')
    .select(
      'id, customer_name, total_amount_cents, currency, tour_instances!inner(starts_at, cancellation_reason, tours!inner(name_es))',
    )
    .not('operator_review_required_at', 'is', null)
    .order('operator_review_required_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as unknown as RawReview[] | null) ?? []).map((r) => ({
    id: r.id,
    customerName: r.customer_name,
    tourName: r.tour_instances?.tours?.name_es ?? '',
    startsAt: r.tour_instances?.starts_at ?? '',
    reason: r.tour_instances?.cancellation_reason ?? null,
    totalAmountCents: r.total_amount_cents,
    currency: r.currency,
  }));
}

export type RescheduleTarget = { id: string; startsAt: string; seatsLeft: number };

/**
 * Salidas futuras, no canceladas, del mismo tour. Los cupos libres no restan los apartados en
 * curso: la base los cuenta al mover y rechaza si no alcanzan.
 */
export async function listRescheduleTargets(
  tourId: string,
  excludeInstanceId: string,
  now: Date = new Date(),
): Promise<RescheduleTarget[]> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from('tour_instances')
    .select('id, starts_at, capacity_total, capacity_reserved')
    .eq('tour_id', tourId)
    .neq('id', excludeInstanceId)
    .neq('status', InstanceStatus.Cancelled)
    .gt('starts_at', now.toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => ({
      id: r.id,
      startsAt: r.starts_at,
      seatsLeft: r.capacity_total - r.capacity_reserved,
    }))
    .filter((target) => target.seatsLeft > 0);
}

type RawRefund = {
  id: string;
  booking_id: string;
  status: RefundStatus;
  amount_cents: number;
  currency: string;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  transfer_requested_at: string | null;
  bookings: {
    customer_name: string;
    tour_instances: { starts_at: string; tours: { name_es: string } | null } | null;
  } | null;
};

const TRAY_STATUSES = [
  RefundStatus.Failed,
  RefundStatus.AwaitingTransfer,
  RefundStatus.Pending,
  RefundStatus.Processing,
];

/**
 * Reembolsos que esperan algo del operador (spec 0038). Trae todos los reembolsos de las reservas
 * que tienen alguno pendiente, para que la selección mire el más nuevo de cada reserva.
 */
export async function listRefundsToResolve(now: Date = new Date()): Promise<RefundToResolve[]> {
  const sb = await createSupabaseServerClient();
  const { data: open, error: openError } = await sb
    .from('refunds')
    .select('booking_id')
    .in('status', TRAY_STATUSES);
  if (openError) throw new Error(openError.message);
  const bookingIds = [...new Set((open ?? []).map((r) => r.booking_id))];
  if (bookingIds.length === 0) return [];

  const { data, error } = await sb
    .from('refunds')
    .select(
      'id, booking_id, status, amount_cents, currency, failure_reason, created_at, updated_at, transfer_requested_at, bookings!inner(customer_name, tour_instances!inner(starts_at, tours!inner(name_es)))',
    )
    .in('booking_id', bookingIds);
  if (error) throw new Error(error.message);

  const rows: RefundTrayRow[] = ((data as unknown as RawRefund[] | null) ?? []).map((r) => ({
    id: r.id,
    bookingId: r.booking_id,
    status: r.status,
    amountCents: r.amount_cents,
    currency: r.currency,
    failureReason: r.failure_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    transferRequestedAt: r.transfer_requested_at,
    customerName: r.bookings?.customer_name ?? '',
    tourName: r.bookings?.tour_instances?.tours?.name_es ?? '',
    startsAt: r.bookings?.tour_instances?.starts_at ?? '',
  }));
  return selectRefundsToResolve(rows, now);
}
