import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { PaymentProvider } from '@/lib/payments/types';
import { alertManualChargeReview, ManualChargeReview } from './manual-charge-alerts';

// Cierre del intent que conserva una reserva antes de crear otro (spec 0029 §5.6): nunca hay dos
// intents vivos por reserva. `null` habilita a crear uno nuevo; `review` deja todo como está.

type ServiceClient = SupabaseClient<Database>;
type RetainedOutcome = { kind: 'review' } | null;
type BookingRef = { id: string };

/** Cancela el intent retenido y cierra su pago; null habilita a crear uno nuevo. */
export async function replaceRetained(
  db: ServiceClient,
  provider: PaymentProvider,
  booking: BookingRef,
  intentId: string,
): Promise<RetainedOutcome> {
  const cancelled = await provider.cancelPaymentSession(intentId).then(
    () => true,
    () => false,
  );
  if (cancelled) return closeRetained(db, booking, intentId);
  alertManualChargeReview(ManualChargeReview.UnexpectedIntent, booking.id, intentId);
  return { kind: 'review' };
}

/** Cierra el pago de un intent ya cerrado en la pasarela; null habilita a crear uno nuevo. */
export async function closeRetained(
  db: ServiceClient,
  booking: BookingRef,
  intentId: string,
): Promise<RetainedOutcome> {
  const { data: closed, error } = await db.rpc('close_pending_payment', {
    p_booking_id: booking.id,
    p_external_payment_id: intentId,
  });
  if (error) throw new Error(`close_pending_payment: ${error.message}`);
  if (closed) return null;
  // Rowcount 0 (§5.6): otro actor cambió la reserva en el medio. No se crea nada.
  alertManualChargeReview(ManualChargeReview.CloseSkipped, booking.id, intentId);
  return { kind: 'review' };
}
