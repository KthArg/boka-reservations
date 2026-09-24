import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { BookingStatus } from '@shared/constants/enums';
import {
  AuthorizationClaimOutcome,
  AuthorizedCancelOutcome,
  CancellationError,
  type UnpaidCancelReasonValue,
} from '@shared/constants/cancellations';
import { getPaymentProvider, type PaymentProvider } from '@/lib/payments';
import { captureAlert } from './sentry-alert';

// Cancelación de una reserva con una autorización viva (spec 0033 §5.6). El orden importa, porque
// el worker puede estar por capturar esa misma intención: primero se reclama la reserva bajo lock,
// después se suelta la retención en la pasarela y recién entonces se cierra la cancelación.

type ServiceClient = SupabaseClient<Database>;

export type AuthorizedCancelResult =
  | { handled: false }
  | { handled: true; ok: true }
  | { handled: true; ok: false; error: CancellationError };

const NOT_HANDLED = { handled: false } as const;

/**
 * Cancela la reserva si tiene una autorización viva. Devuelve `handled: false` cuando no la tiene,
 * para que el llamador siga por el camino de siempre.
 */
export async function cancelAuthorizedBooking(
  db: ServiceClient,
  bookingId: string,
  reason: UnpaidCancelReasonValue,
  actorId: string | null,
  provider?: PaymentProvider,
): Promise<AuthorizedCancelResult> {
  const { data: claim, error: claimError } = await db.rpc('claim_authorization_cancel', {
    p_booking_id: bookingId,
    p_actor_id: actorId,
    p_reason: reason,
  });
  if (claimError) return failed(CancellationError.WriteFailed);
  if (claim === AuthorizationClaimOutcome.NotAuthorized) return NOT_HANDLED;
  if (claim === AuthorizationClaimOutcome.CaptureInProgress) {
    return failed(CancellationError.ChargeInFlight);
  }

  // El intent se lee DESPUÉS del reclamo: leerlo antes abriría una ventana en la que el worker
  // cierra ese pago y abre otro, y se cancelaría el viejo dejando viva la retención nueva.
  // Sin intent registrado no hay retención que soltar, pero la reserva sí quedó reclamada: se
  // cierra igual, porque dejarla marcada la trabaría hasta que el worker limpie la marca.
  const intentId = await liveIntentOf(db, bookingId);
  if (intentId && !(await releaseHold(db, bookingId, intentId, provider))) {
    return failed(CancellationError.WriteFailed);
  }

  const { data, error } = await db.rpc('cancel_authorized_booking', {
    p_booking_id: bookingId,
    p_actor_id: actorId,
    p_reason: reason,
  });
  if (error) return failed(CancellationError.WriteFailed);
  if (data !== AuthorizedCancelOutcome.Cancelled) {
    return failed(CancellationError.NotCancellable);
  }
  return { handled: true, ok: true };
}

/**
 * Suelta la retención en la pasarela. Si falla, se libera la marca y se responde el error
 * genérico: la reserva queda como estaba y el turista puede reintentar. Cancelar en la base sin
 * haber soltado la retención dejaría plata retenida sin reserva que la explique.
 */
async function releaseHold(
  db: ServiceClient,
  bookingId: string,
  intentId: string,
  provider?: PaymentProvider,
): Promise<boolean> {
  try {
    // La pasarela se resuelve acá y no en la firma: la mayoría de las cancelaciones no tiene
    // ninguna retención que soltar y no tiene por qué construir el cliente.
    await (provider ?? getPaymentProvider()).cancelPaymentSession(intentId);
    return true;
  } catch (err) {
    captureAlert(
      '[cancel] no se pudo soltar la autorización',
      'authorization-release-failed',
      { bookingId, intentId, error: err instanceof Error ? err.message : 'unknown' },
      'error',
    );
    const { error } = await db
      .from('bookings')
      .update({ cancel_claimed_at: null })
      .eq('id', bookingId)
      .eq('status', BookingStatus.PendingPayment);
    // Si ni siquiera se pudo liberar la marca, la reserva queda trabada hasta que el worker la
    // limpie a los 15 minutos: hay que verlo.
    if (error) {
      captureAlert(
        '[cancel] no se pudo liberar la marca de cancelación',
        'cancel-claim-stuck',
        { bookingId, error: error.message },
        'error',
      );
    }
    return false;
  }
}

/** El intent vigente de la reserva: el pago `pending` que dejó la autorización. */
async function liveIntentOf(db: ServiceClient, bookingId: string): Promise<string | null> {
  const { data } = await db
    .from('payments')
    .select('external_payment_id')
    .eq('booking_id', bookingId)
    .eq('status', 'pending')
    .maybeSingle();
  return data?.external_payment_id ?? null;
}

function failed(error: CancellationError): AuthorizedCancelResult {
  return { handled: true, ok: false, error };
}
