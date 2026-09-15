import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { BookingStatus } from '@shared/constants/enums';
import type { AuditActorType } from '@shared/constants/audit';
import { CancellationError } from '@shared/constants/cancellations';
import { computeRefund, type RefundEligibility } from '@shared/constants/policies';
import { cancelUnpaidBooking } from './cancel-unpaid';
import { isAwaitingAuthentication, isCardUpdateOpen } from './deferred-booking-rules';

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
  /** Cobro diferido en curso (spec 0029 §5.8): no se puede cancelar hasta que se resuelva. */
  chargeInFlight: boolean;
  /** Sin cobrar y con un rechazo registrado (spec 0029 §5.7): puede cargar otra tarjeta. */
  canUpdateCard: boolean;
  /** Cobro esperando la autenticación 3DS del turista, con el plazo vigente. */
  awaitingAuthentication: boolean;
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
  charge_started_at, charge_attempts, awaiting_action_until, recovery_deadline,
  tickets_adult, tickets_child, tickets_student,
  tour_instances!inner ( starts_at, tours!inner ( name_es, name_en ) )
`;

interface RawView {
  id: string;
  customer_name: string;
  status: string;
  total_amount_cents: number;
  currency: string;
  charge_started_at: string | null;
  charge_attempts: number;
  awaiting_action_until: string | null;
  recovery_deadline: string | null;
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
  const inFlight = r.status === BookingStatus.PendingPayment && r.charge_started_at !== null;
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
    chargeInFlight: inFlight,
    // El enlace a la página de tarjeta solo tras un rechazo; la página aplica la misma regla.
    canUpdateCard: r.charge_attempts > 0 && isCardUpdateOpen(r.status, r.recovery_deadline, now),
    awaitingAuthentication:
      inFlight && isAwaitingAuthentication(r.status, r.awaiting_action_until, now),
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
  // Sin cobrar (spec 0029): una pending_minimum se cancela sin reembolso; una pending_payment
  // del flujo diferido con el cobro en vuelo se rechaza, y la del widget sigue sin ser
  // cancelable (la función devuelve not_cancellable).
  if (
    view.status === BookingStatus.PendingMinimum ||
    view.status === BookingStatus.PendingPayment
  ) {
    return cancelUnpaidBooking(db, params.bookingId, params.actorType, params.actorId ?? null);
  }
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
