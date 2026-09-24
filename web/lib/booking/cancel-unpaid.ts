import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { AuditActorType } from '@shared/constants/audit';
import {
  CancellationError,
  UnpaidCancelOutcome,
  UnpaidCancelReason,
} from '@shared/constants/cancellations';
import { NO_REFUND, type RefundEligibility } from '@shared/constants/policies';
import type { PaymentProvider } from '@/lib/payments';
import { cancelAuthorizedBooking } from './cancel-authorized';

// Cancelación de una reserva sin cobrar del flujo diferido (spec 0029 §5.8), vía la función
// atómica cancel_unpaid_booking: libera el hold, cierra el pago pendiente y encola el aviso.
// No hay reembolso porque no hubo cobro. Rechaza un cobro en vuelo: la UI pide reintentar.
// Con una autorización viva (spec 0033) el camino es otro: primero hay que soltar la retención.

type ServiceClient = SupabaseClient<Database>;

/** Sin cobro no hay nada que reembolsar. */
export const NO_CHARGE_REFUND: RefundEligibility = NO_REFUND;

export type UnpaidCancelResult =
  | { ok: true; refund: RefundEligibility }
  | { ok: false; error: CancellationError };

export async function cancelUnpaidBooking(
  db: ServiceClient,
  bookingId: string,
  actorType: AuditActorType,
  actorId: string | null,
  provider?: PaymentProvider,
): Promise<UnpaidCancelResult> {
  // El motivo sale de quién cancela, no de si hay actorId: un caller del panel sin id no queda
  // auditado como pedido del turista.
  const reason =
    actorType === AuditActorType.Tourist
      ? UnpaidCancelReason.CustomerRequest
      : UnpaidCancelReason.StaffRequest;

  const authorized = await cancelAuthorizedBooking(db, bookingId, reason, actorId, provider);
  if (authorized.handled) {
    if (!authorized.ok) return { ok: false, error: authorized.error };
    return { ok: true, refund: NO_CHARGE_REFUND };
  }

  const { data, error } = await db.rpc('cancel_unpaid_booking', {
    p_booking_id: bookingId,
    p_actor_id: actorId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: CancellationError.WriteFailed };
  if (data === UnpaidCancelOutcome.ChargeInFlight) {
    return { ok: false, error: CancellationError.ChargeInFlight };
  }
  if (data !== UnpaidCancelOutcome.Cancelled) {
    return { ok: false, error: CancellationError.NotCancellable };
  }
  return { ok: true, refund: NO_CHARGE_REFUND };
}
