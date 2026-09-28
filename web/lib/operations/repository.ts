import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { InstanceStatus } from '@shared/constants/enums';
import type { DepartureCancellationReasonValue } from '@shared/constants/operations';

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
  return (data ?? []).map((r) => ({
    id: r.id,
    startsAt: r.starts_at,
    seatsLeft: r.capacity_total - r.capacity_reserved,
  }));
}
