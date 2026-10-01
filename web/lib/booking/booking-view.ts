import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { BookingStatus } from '@shared/constants/enums';
import { CancellationReason } from '@shared/constants/cancellations';
import { computeRefund, NO_REFUND, type RefundEligibility } from '@shared/constants/policies';
import { isAwaitingAuthentication, isCardUpdateOpen } from './deferred-booking-rules';

// Vista de una reserva para las páginas del turista (ver y cancelar) y para cancelBooking.

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
  /** `bookings.terms_version`: la versión de los términos que aceptó el turista. */
  termsVersion: string | null;
  /** Reembolso que correspondería si el turista cancelara ahora (solo reservas confirmadas). */
  refund: RefundEligibility;
  /** Cobro diferido en curso (spec 0029 §5.8): no se puede cancelar hasta que se resuelva. */
  chargeInFlight: boolean;
  /**
   * Monto autorizado y todavía sin capturar (spec 0033 §5.6). No es un cobro en curso: la
   * retención puede vivir hasta 48 horas y el turista puede cancelar mientras tanto.
   */
  authorizationHeld: boolean;
  /** Sin cobrar y con un rechazo registrado (spec 0029 §5.7): puede cargar otra tarjeta. */
  canUpdateCard: boolean;
  /** Cobro esperando la autenticación 3DS del turista, con el plazo vigente. */
  awaitingAuthentication: boolean;
  /** Salida cancelada por clima o seguridad: la reserva espera la decisión del equipo (spec 0035). */
  underReview: boolean;
  /** Motivo de cancelación de la salida, si se canceló. */
  cancellationReason: string | null;
};

const VIEW_SELECT = `
  id, customer_name, status, total_amount_cents, currency, terms_version,
  charge_started_at, charge_attempts, awaiting_action_until, recovery_deadline, authorized_at,
  tickets_adult, tickets_child, tickets_student, operator_review_required_at,
  tour_instances!inner ( starts_at, cancellation_reason, tours!inner ( name_es, name_en ) )
`;

interface RawView {
  id: string;
  customer_name: string;
  status: string;
  total_amount_cents: number;
  currency: string;
  terms_version: string | null;
  charge_started_at: string | null;
  charge_attempts: number;
  awaiting_action_until: string | null;
  recovery_deadline: string | null;
  authorized_at: string | null;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
  operator_review_required_at: string | null;
  tour_instances: {
    starts_at: string;
    cancellation_reason: string | null;
    tours: { name_es: string; name_en: string } | null;
  } | null;
}

/** Reembolso que vería el turista al cancelar ahora. Solo una reserva confirmada tiene cobro. */
function customerRefundPreview(r: RawView, startsAt: string, now: Date): RefundEligibility {
  if (r.status !== BookingStatus.Confirmed || r.operator_review_required_at !== null) {
    return NO_REFUND;
  }
  return computeRefund({
    startsAt: new Date(startsAt),
    totalAmountCents: r.total_amount_cents,
    reason: CancellationReason.CustomerRequest,
    now,
  });
}

function toView(r: RawView, now: Date): BookingView {
  const startsAt = r.tour_instances?.starts_at ?? '';
  const authorizationHeld = r.status === BookingStatus.PendingPayment && r.authorized_at !== null;
  const inFlight =
    r.status === BookingStatus.PendingPayment && r.charge_started_at !== null && !authorizationHeld;
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
    termsVersion: r.terms_version,
    refund: customerRefundPreview(r, startsAt, now),
    chargeInFlight: inFlight,
    authorizationHeld,
    // El enlace a la página de tarjeta solo tras un rechazo; la página aplica la misma regla.
    canUpdateCard: r.charge_attempts > 0 && isCardUpdateOpen(r.status, r.recovery_deadline, now),
    awaitingAuthentication:
      inFlight && isAwaitingAuthentication(r.status, r.awaiting_action_until, now),
    underReview: r.operator_review_required_at !== null,
    cancellationReason: r.tour_instances?.cancellation_reason ?? null,
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
