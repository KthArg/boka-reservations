import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { toRangeBounds, type ReportRange } from './range';
import type { RevenueRow, OccupancyRow, RefundsSummary } from './types';

export type { RevenueRow, OccupancyRow, RefundsSummary } from './types';

export async function getRevenueReport(range: ReportRange): Promise<RevenueRow[]> {
  const db = await createSupabaseServerClient();
  const { fromIso, toIso } = toRangeBounds(range);
  const { data, error } = await db.rpc('report_revenue', { p_from: fromIso, p_to: toIso });
  if (error) throw new Error(`report_revenue: ${error.message}`);
  return (data ?? []).map((r) => ({
    tourId: r.tour_id,
    nameEs: r.name_es,
    nameEn: r.name_en,
    grossCents: r.gross_cents,
    refundedCents: r.refunded_cents,
    netCents: r.net_cents,
    currency: r.currency,
  }));
}

export async function getOccupancyReport(range: ReportRange): Promise<OccupancyRow[]> {
  const db = await createSupabaseServerClient();
  const { fromIso, toIso } = toRangeBounds(range);
  const { data, error } = await db.rpc('report_occupancy', { p_from: fromIso, p_to: toIso });
  if (error) throw new Error(`report_occupancy: ${error.message}`);
  return (data ?? []).map((r) => ({
    tourId: r.tour_id,
    nameEs: r.name_es,
    nameEn: r.name_en,
    bookingsCount: r.bookings_count,
    ticketsSold: r.tickets_sold,
    capacityTotal: r.capacity_total,
    occupancyPct: r.occupancy_pct,
    noShowCount: r.no_show_count,
    pastBookingsCount: r.past_bookings_count,
  }));
}

const EMPTY_REFUNDS: RefundsSummary = {
  refundsCount: 0,
  refundsAmountCents: 0,
  cancelledCount: 0,
  validBookingsCount: 0,
  currency: 'USD',
};

export async function getRefundsSummary(range: ReportRange): Promise<RefundsSummary> {
  const db = await createSupabaseServerClient();
  const { fromIso, toIso } = toRangeBounds(range);
  const { data, error } = await db.rpc('report_refunds_summary', { p_from: fromIso, p_to: toIso });
  if (error) throw new Error(`report_refunds_summary: ${error.message}`);
  const row = data?.[0];
  if (!row) return EMPTY_REFUNDS;
  return {
    refundsCount: row.refunds_count,
    refundsAmountCents: row.refunds_amount_cents,
    cancelledCount: row.cancelled_count,
    validBookingsCount: row.valid_bookings_count,
    currency: row.currency,
  };
}
