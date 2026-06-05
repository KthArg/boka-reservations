import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { BookingStatus } from '@shared/constants/enums';
import type { AuditActorType } from '@shared/constants/audit';
import { CancellationError } from '@shared/constants/cancellations';
import { computeRefund, type RefundEligibility } from '@shared/constants/policies';

type ServiceClient = SupabaseClient<Database>;

export type BookingView = {
  id: string;
  customerName: string;
  status: string;
  startsAt: string;
  tourNameEs: string;
  tourNameEn: string;
  ticketsAdult: number;
  ticketsChild: number;
  ticketsStudent: number;
  totalAmountCents: number;
  currency: string;
  /** Reembolso que correspondería si se cancelara ahora. */
  refund: RefundEligibility;
};

export type CancelResult =
  | { ok: true; refund: RefundEligibility }
  | { ok: false; error: CancellationError };

type CancelParams = {
  bookingId: string;
  actorType: AuditActorType;
  actorId?: string | null;
};

const VIEW_SELECT = `
  id, customer_name, status, total_amount_cents, currency,
  tickets_adult, tickets_child, tickets_student,
  tour_instances!inner ( starts_at, tours!inner ( name_es, name_en ) )
`;

interface RawView {
  id: string;
  customer_name: string;
  status: string;
  total_amount_cents: number;
  currency: string;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
  tour_instances: {
    starts_at: string;
    tours: { name_es: string; name_en: string } | null;
  } | null;
}

function toView(r: RawView, now: Date): BookingView {
  const startsAt = r.tour_instances?.starts_at ?? '';
  return {
    id: r.id,
    customerName: r.customer_name,
    status: r.status,
    startsAt,
    tourNameEs: r.tour_instances?.tours?.name_es ?? '',
    tourNameEn: r.tour_instances?.tours?.name_en ?? '',
    ticketsAdult: r.tickets_adult,
    ticketsChild: r.tickets_child,
    ticketsStudent: r.tickets_student,
    totalAmountCents: r.total_amount_cents,
    currency: r.currency,
    refund: computeRefund({
      startsAt: new Date(startsAt),
      totalAmountCents: r.total_amount_cents,
      now,
    }),
  };
}

/** Carga la vista de una reserva (para la página de ver/cancelar). */
export async function getBookingView(
  db: ServiceClient,
  bookingId: string,
  now: Date = new Date(),
): Promise<BookingView | null> {
  const { data } = await db.from('bookings').select(VIEW_SELECT).eq('id', bookingId).maybeSingle();
  if (!data) return null;
  return toView(data as unknown as RawView, now);
}

/**
 * Cancela una reserva confirmada vía la función DB atómica `cancel_booking`
 * (libera cupo, cancela el recordatorio, encola el email y el refund si
 * corresponde). El monto del reembolso se calcula acá (regla de política) al
 * momento de ejecutar. Idempotente ante doble cancelación por el guard de la
 * función. Devuelve el reembolso aplicado para que la UI lo muestre.
 */
export async function cancelBooking(
  db: ServiceClient,
  params: CancelParams,
  now: Date = new Date(),
): Promise<CancelResult> {
  const view = await getBookingView(db, params.bookingId, now);
  if (!view) return { ok: false, error: CancellationError.NotFound };
  if (view.status !== BookingStatus.Confirmed) {
    return { ok: false, error: CancellationError.NotCancellable };
  }

  const refund = computeRefund({
    startsAt: new Date(view.startsAt),
    totalAmountCents: view.totalAmountCents,
    now,
  });

  const { error } = await db.rpc('cancel_booking', {
    p_booking_id: params.bookingId,
    p_actor_type: params.actorType,
    p_refund_amount_cents: refund.amountCents,
    ...(params.actorId ? { p_actor_id: params.actorId } : {}),
  });
  if (error) return { ok: false, error: CancellationError.WriteFailed };

  return { ok: true, refund };
}
