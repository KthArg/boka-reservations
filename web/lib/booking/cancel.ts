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
 * la antelación (specs 0032 y 0034: siempre completo o nada). Si el estado o el monto no
 * coinciden con lo que vio quien cancela, no cancela. Idempotente ante doble cancelación por el guard de la función.
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
  // Salida cancelada por clima o seguridad (spec 0035): la decide el equipo, no esta cancelación.
  if (view.underReview) return { ok: false, error: CancellationError.UnderReview };

  // Spec 0032: el staff elige el motivo; el turista siempre cancela a pedido propio.
  const reason = params.reason;
  if (!reason) return { ok: false, error: CancellationError.ReasonRequired };
  const departureStarted = new Date(view.startsAt).getTime() <= now.getTime();
  if (reason === CancellationReason.OperatorDecision && departureStarted && !params.isAdmin) {
    return { ok: false, error: CancellationError.OperatorRefundAdminOnly };
  }

  const refund = computeRefund({
    startsAt: new Date(view.startsAt),
    totalAmountCents: view.totalAmountCents,
    reason,
    now,
  });
  // Una reserva cobrada solo se cancela contra el monto que vio quien cancela: sin él no hay
  // forma de saber si se cruzó el borde de 24 h.
  if (!params.expected || params.expected.refundAmountCents !== refund.amountCents) {
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
  // La salida se canceló por clima o seguridad entre la lectura y la cancelación (spec 0035).
  if (data === CancelBookingOutcome.UnderReview) {
    return { ok: false, error: CancellationError.UnderReview };
  }

  return { ok: true, refund };
}
