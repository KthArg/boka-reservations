import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { BookingStatus } from '@shared/constants/enums';
import { CancellationReason } from '@shared/constants/cancellations';
import { computeRefund, NO_REFUND, type RefundEligibility } from '@shared/constants/policies';
import { captureAlert } from './sentry-alert';
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
  /** `bookings.terms_version`: decide si el reembolso descuenta la comisión (spec 0032). */
  termsVersion: string | null;
  /** Reembolso que correspondería si el turista cancelara ahora (solo reservas confirmadas). */
  refund: RefundEligibility;
  /** Cobro diferido en curso (spec 0029 §5.8): no se puede cancelar hasta que se resuelva. */
  chargeInFlight: boolean;
  /** Sin cobrar y con un rechazo registrado (spec 0029 §5.7): puede cargar otra tarjeta. */
  canUpdateCard: boolean;
  /** Cobro esperando la autenticación 3DS del turista, con el plazo vigente. */
  awaitingAuthentication: boolean;
};

const VIEW_SELECT = `
  id, customer_name, status, total_amount_cents, currency, terms_version,
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
  terms_version: string | null;
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

/**
 * Reembolso que vería el turista al cancelar ahora. Solo una reserva confirmada tiene cobro que
 * reembolsar. Un error de configuración de la comisión no tira la página: se reporta y se muestra
 * sin reembolso; la cancelación en sí lo vuelve a calcular y falla sin aplicar nada.
 */
function customerRefundPreview(r: RawView, startsAt: string, now: Date): RefundEligibility {
  if (r.status !== BookingStatus.Confirmed) return NO_REFUND;
  try {
    return computeRefund({
      startsAt: new Date(startsAt),
      totalAmountCents: r.total_amount_cents,
      currency: r.currency,
      termsVersion: r.terms_version,
      reason: CancellationReason.CustomerRequest,
      now,
    });
  } catch (err) {
    captureAlert('[cancel] no se pudo calcular el reembolso', 'refund-preview-failed', {
      bookingId: r.id,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return NO_REFUND;
  }
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
    termsVersion: r.terms_version,
    refund: customerRefundPreview(r, startsAt, now),
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
