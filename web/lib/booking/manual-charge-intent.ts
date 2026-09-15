import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  PaymentIntentStatus,
  type IntentSnapshot,
  type PaymentProvider,
} from '@/lib/payments/types';
import { BookingStatus, PaymentStatus } from '@shared/constants/enums';
import {
  alertIntentCreationFailed,
  alertManualChargeReview,
  alertRetainedIntentActive,
  ManualChargeReview,
} from './manual-charge-alerts';

// Intent del cobro manual (spec 0029 §5.6): un solo intent vivo por reserva. Si la reserva conserva
// uno, primero el GET: solo se re-confirma sobre requires_payment_method; succeeded se asienta y
// nunca se re-confirma; processing o requires_action esperan. Solo canceled o failed habilitan uno
// nuevo, y antes se cierra su fila con close_pending_payment.

type ServiceClient = SupabaseClient<Database>;

// Espejo de la hora mínima de charge_booking_start: evita crear y cancelar un intent en OnvoPay
// por cada click. La garantía sigue en SQL.
const RETRY_SPACING_MS = 60 * 60 * 1000;
const DESCRIPTION_ID_LENGTH = 8;

export type ChargeableBooking = {
  id: string;
  paymentMethodId: string;
  totalAmountCents: number;
  currency: string;
  locale: string;
  chargeStartedAt: string | null;
  pendingIntentId: string | null;
};

export type PreparedIntent =
  | { kind: 'ready'; externalPaymentId: string; created: boolean }
  | { kind: 'settle'; externalPaymentId: string; snapshot: IntentSnapshot }
  | { kind: 'wait' }
  | { kind: 'too_soon' }
  | { kind: 'review' };

type Row = {
  id: string;
  status: string;
  locale: string;
  payment_method_id: string | null;
  total_amount_cents: number;
  currency: string;
  charge_started_at: string | null;
  payments: { external_payment_id: string; status: string }[];
};

/** La reserva, si todavía es cobrable desde el panel (sin cobrar y con tarjeta guardada). */
export async function loadChargeableBooking(
  db: ServiceClient,
  bookingId: string,
): Promise<ChargeableBooking | null> {
  const { data, error } = await db
    .from('bookings')
    .select(
      'id, status, locale, payment_method_id, total_amount_cents, currency, charge_started_at, payments(external_payment_id, status)',
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw new Error(`load booking: ${error.message}`);
  const row = data as unknown as Row | null;
  if (row?.status !== BookingStatus.PendingMinimum || !row.payment_method_id) return null;
  const pending = row.payments.find((p) => p.status === PaymentStatus.Pending);
  return {
    id: row.id,
    paymentMethodId: row.payment_method_id,
    totalAmountCents: row.total_amount_cents,
    currency: row.currency,
    locale: row.locale,
    chargeStartedAt: row.charge_started_at,
    pendingIntentId: pending?.external_payment_id ?? null,
  };
}

function withinRetrySpacing(booking: ChargeableBooking, now: Date): boolean {
  if (booking.chargeStartedAt === null) return false;
  return new Date(booking.chargeStartedAt).getTime() + RETRY_SPACING_MS > now.getTime();
}

/** Qué hacer con el intent que conserva la reserva, o null si hay que crear uno nuevo. */
async function resolveRetainedIntent(
  db: ServiceClient,
  provider: PaymentProvider,
  booking: ChargeableBooking,
  intentId: string,
): Promise<PreparedIntent | null> {
  const snapshot = await provider.getPaymentIntent(intentId);
  switch (snapshot.status) {
    case PaymentIntentStatus.Succeeded:
      return { kind: 'settle', externalPaymentId: intentId, snapshot };
    case PaymentIntentStatus.RequiresPaymentMethod:
      return { kind: 'ready', externalPaymentId: intentId, created: false };
    case PaymentIntentStatus.Processing:
    case PaymentIntentStatus.RequiresAction:
      alertRetainedIntentActive(booking.id, intentId, snapshot.status);
      return { kind: 'wait' };
    case PaymentIntentStatus.Canceled:
    case PaymentIntentStatus.Failed: {
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
    default:
      alertManualChargeReview(ManualChargeReview.UnexpectedIntent, booking.id, intentId);
      return { kind: 'review' };
  }
}

export async function prepareIntent(
  db: ServiceClient,
  provider: PaymentProvider,
  booking: ChargeableBooking,
  now: Date = new Date(),
): Promise<PreparedIntent> {
  if (booking.pendingIntentId) {
    const resolved = await resolveRetainedIntent(db, provider, booking, booking.pendingIntentId);
    if (resolved) return resolved;
  }
  if (withinRetrySpacing(booking, now)) return { kind: 'too_soon' };

  try {
    const { externalPaymentId } = await provider.createPaymentSession({
      amountCents: booking.totalAmountCents,
      currency: booking.currency,
      description: `Booking ${booking.id.slice(0, DESCRIPTION_ID_LENGTH)}`,
    });
    return { kind: 'ready', externalPaymentId, created: true };
  } catch (err) {
    alertIntentCreationFailed(booking.id);
    throw err;
  }
}
