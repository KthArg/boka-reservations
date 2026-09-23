import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { resolveAuthoritativeCharge } from '@/lib/booking/checkout-pricing';
import { getPaymentProvider } from '@/lib/payments';
import type { PaymentMethodDetails } from '@/lib/payments/types';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '@shared/constants/legal';
import { BookingStatus, HoldStatus } from '@shared/constants/enums';
import { DeferredCheckoutCode } from './deferred-checkout-errors';
import { alertCardCustomerMismatch } from './deferred-checkout-alerts';
import { DEFERRED_CURRENCY, type DeferredCheckoutParams } from './deferred-checkout';

// Paso 2 del checkout diferido (spec 0029 §5.2): con el paymentMethodId que devolvió OnvoPay, el
// servidor valida el hold y la sesión, lee la tarjeta por GET, recalcula el monto y crea la
// reserva con create_deferred_booking. No confía en nada de lo que reenvía el navegador.

type ServiceClient = SupabaseClient<Database>;

export type DeferredCheckoutCompleteParams = DeferredCheckoutParams & {
  holdId: string;
  paymentMethodId: string;
  /** Monto que mostró el mandato que el turista aceptó. */
  expectedAmountCents: number;
};

type UsableCard = PaymentMethodDetails & { last4: string; expMonth: number; expYear: number };

const DETACHED_METHOD = 'detached';
const LIVE_BOOKING_STATUSES = [BookingStatus.PendingMinimum, BookingStatus.PendingPayment];

async function loadHold(db: ServiceClient, holdId: string) {
  const { data, error } = await db
    .from('tour_holds')
    .select('status, session_token, tour_instance_id, customer_external_id')
    .eq('id', holdId)
    .maybeSingle();
  if (error) throw new Error(`load hold: ${error.message}`);
  return data;
}

/** Paso 2 repetido tras un éxito cuya respuesta se perdió: la misma reserva, no una segunda. */
async function bookingAlreadyCreated(db: ServiceClient, holdId: string): Promise<string | null> {
  const { data, error } = await db
    .from('bookings')
    .select('id')
    .eq('hold_id', holdId)
    .in('status', LIVE_BOOKING_STATUSES)
    .maybeSingle();
  if (error) throw new Error(`load booking of hold: ${error.message}`);
  return data?.id ?? null;
}

function assertUsableCard(
  card: PaymentMethodDetails,
  params: DeferredCheckoutCompleteParams,
  holdCustomerId: string,
): asserts card is UsableCard {
  if (card.customerId !== holdCustomerId) {
    alertCardCustomerMismatch(params.holdId);
    throw new Error(DeferredCheckoutCode.CardCustomerMismatch);
  }
  const incomplete = card.last4 === null || card.expMonth === null || card.expYear === null;
  if (card.id !== params.paymentMethodId || card.status === DETACHED_METHOD || incomplete) {
    throw new Error(DeferredCheckoutCode.CardInvalid);
  }
}

export async function completeDeferredCheckout(
  params: DeferredCheckoutCompleteParams,
): Promise<{ bookingId: string }> {
  const db = createSupabaseServiceClient();
  const hold = await loadHold(db, params.holdId);
  // Sesión y salida antes de llamar a OnvoPay: sin la cookie del paso 1 no se consume la API.
  if (
    !hold?.customer_external_id ||
    hold.tour_instance_id !== params.instanceId ||
    hold.session_token !== params.sessionToken
  ) {
    throw new Error(DeferredCheckoutCode.HoldInvalid);
  }
  if (hold.status === HoldStatus.Paying) {
    const bookingId = await bookingAlreadyCreated(db, params.holdId);
    if (bookingId) return { bookingId };
  }
  if (hold.status !== HoldStatus.Active) throw new Error(DeferredCheckoutCode.HoldInvalid);

  const card = await getPaymentProvider().getPaymentMethod(params.paymentMethodId);
  assertUsableCard(card, params, hold.customer_external_id);

  const { totalAmountCents } = await resolveAuthoritativeCharge(
    db,
    params.instanceId,
    params.quantities,
    params.locale,
  );
  // El mandato aceptado mostraba el monto del paso 1: no se guarda uno distinto (precio cambiado
  // entre pasos, o tickets alterados por el cliente).
  if (totalAmountCents !== params.expectedAmountCents) {
    throw new Error(DeferredCheckoutCode.AmountChanged);
  }

  const { data: bookingId, error } = await db.rpc('create_deferred_booking', {
    p_hold_id: params.holdId,
    p_session_token: params.sessionToken,
    p_customer_name: params.customerName,
    p_customer_email: params.customerEmail,
    p_locale: params.locale,
    p_tickets_adult: params.quantities.adult,
    p_tickets_child: params.quantities.child,
    p_tickets_student: params.quantities.student,
    p_total_amount_cents: totalAmountCents,
    p_currency: DEFERRED_CURRENCY,
    p_consent_version: PRIVACY_NOTICE_VERSION,
    p_terms_version: TERMS_VERSION,
    p_payment_method_id: card.id,
    p_customer_external_id: hold.customer_external_id,
    p_card_brand: card.brand,
    p_card_last4: card.last4,
    p_card_exp_month: card.expMonth,
    p_card_exp_year: card.expYear,
  });
  if (error || !bookingId) throw new Error(error?.message ?? 'create_deferred_booking sin id');
  return { bookingId };
}
