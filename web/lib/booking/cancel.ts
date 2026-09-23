import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { BookingStatus } from '@shared/constants/enums';
import type { AuditActorType } from '@shared/constants/audit';
import {
  CancelBookingOutcome,
  CancellationError,
  CancellationReason,
  type CancellationReasonValue,
} from '@shared/constants/cancellations';
import { computeRefund, type RefundEligibility } from '@shared/constants/policies';
import { captureAlert } from './sentry-alert';
import { cancelUnpaidBooking } from './cancel-unpaid';
import { getBookingView } from './booking-view';

export { getBookingView, type BookingView } from './booking-view';

type ServiceClient = SupabaseClient<Database>;

export type CancelResult =
  | { ok: true; refund: RefundEligibility }
  | { ok: false; error: CancellationError };

/** Lo que vio quien cancela: si cambió al confirmar, no se cancela (spec 0032). */
export type CancelExpectation = { status: string; refundAmountCents: number };

type CancelParams = {
  bookingId: string;
  actorType: AuditActorType;
  actorId?: string | null;
  /** Motivo de cancelar una reserva cobrada (spec 0032). El turista siempre es `customer_request`. */
  reason?: CancellationReasonValue;
  /** Solo un admin reembolsa el total de una salida que ya empezó. */
  isAdmin?: boolean;
  expected?: CancelExpectation;
};

const STATE_CHANGED = { ok: false, error: CancellationError.StateChanged } as const;

/**
 * Cancela una reserva confirmada vía la función DB atómica `cancel_booking`
 * (libera cupo, cancela el recordatorio, encola el email y el refund si
 * corresponde). El monto del reembolso se calcula acá, al momento de ejecutar, según el motivo y
 * la versión de términos aceptada (spec 0032). Si el estado o el monto no coinciden con lo que
 * vio quien cancela, no cancela. Idempotente ante doble cancelación por el guard de la función.
 * Devuelve el reembolso aplicado para que la UI lo muestre.
 */
export async function cancelBooking(
  db: ServiceClient,
  params: CancelParams,
  now: Date = new Date(),
): Promise<CancelResult> {
  const view = await getBookingView(db, params.bookingId, now);
  if (!view) return { ok: false, error: CancellationError.NotFound };
  if (params.expected && params.expected.status !== view.status) return STATE_CHANGED;
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

  // Spec 0032: el staff elige el motivo; el turista siempre cancela a pedido propio.
  const reason = params.reason;
  if (!reason) return { ok: false, error: CancellationError.ReasonRequired };
  const departureStarted = new Date(view.startsAt).getTime() <= now.getTime();
  if (reason === CancellationReason.OperatorDecision && departureStarted && !params.isAdmin) {
    return { ok: false, error: CancellationError.OperatorRefundAdminOnly };
  }

  let refund: RefundEligibility;
  try {
    refund = computeRefund({
      startsAt: new Date(view.startsAt),
      totalAmountCents: view.totalAmountCents,
      currency: view.currency,
      termsVersion: view.termsVersion,
      reason,
      now,
    });
  } catch (err) {
    // Nunca reembolsar un monto mal calculado: la cancelación no se aplica.
    captureAlert(
      '[cancel] no se pudo calcular el reembolso',
      'refund-compute-failed',
      { bookingId: params.bookingId, error: err instanceof Error ? err.message : 'unknown' },
      'error',
    );
    return { ok: false, error: CancellationError.WriteFailed };
  }
  // Se cruzó el borde de 24 h o cambió la política desde que se mostró el monto.
  if (params.expected && params.expected.refundAmountCents !== refund.amountCents) {
    return STATE_CHANGED;
  }

  const { data, error } = await db.rpc('cancel_booking', {
    p_booking_id: params.bookingId,
    p_actor_type: params.actorType,
    p_refund_amount_cents: refund.amountCents,
    p_reason: reason,
    p_fee_cents: refund.feeCents,
    ...(params.actorId ? { p_actor_id: params.actorId } : {}),
  });
  if (error) return { ok: false, error: CancellationError.WriteFailed };
  // Otra cancelación ganó la carrera: no se muestra un monto que no se aplicó.
  if (data === CancelBookingOutcome.AlreadyCancelled) {
    return { ok: false, error: CancellationError.NotCancellable };
  }

  return { ok: true, refund };
}
