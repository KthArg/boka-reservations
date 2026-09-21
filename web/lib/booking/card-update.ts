import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getPaymentProvider } from '@/lib/payments';
import type { PaymentMethodDetails, PaymentProvider } from '@/lib/payments/types';
import { BookingStatus } from '@shared/constants/enums';
import { PRIVACY_NOTICE_VERSION } from '@shared/constants/legal';
import { PG_UNIQUE_VIOLATION } from '@shared/constants/tours';
import {
  CARD_UPDATE_OUTCOME_ERRORS,
  CardUpdateError,
  type CardUpdateErrorValue,
  type CardUpdateResult,
} from './card-update-errors';
import { alertCardNotDetached, alertCardUpdateCustomerMismatch } from './deferred-checkout-alerts';

// Actualización de la tarjeta de una reserva sin cobrar (spec 0029 §5.2, §5.7). Mismas reglas que
// el checkout: el servidor lee la tarjeta por GET, exige el customer de la reserva, y la función SQL
// valida el vencimiento, el tope de cambios y la tarjeta en otra reserva viva. Una tarjeta nueva
// que nuestras reglas rechazan se desvincula; la reemplazada, solo si la nueva sigue vigente.

type ServiceClient = SupabaseClient<Database>;

const UPDATED = 'updated';
const DETACHED_METHOD = 'detached';

async function currentCardOf(db: ServiceClient, bookingId: string) {
  const { data, error } = await db
    .from('bookings')
    .select('status, customer_external_id, payment_method_id')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw new Error(`load booking: ${error.message}`);
  return data;
}

function isComplete(card: PaymentMethodDetails): boolean {
  return card.last4 !== null && card.expMonth !== null && card.expYear !== null;
}

/** Rechaza la tarjeta nueva y la desvincula del customer: no respalda ninguna reserva. */
async function reject(
  provider: PaymentProvider,
  bookingId: string,
  paymentMethodId: string,
  error: CardUpdateErrorValue,
): Promise<CardUpdateResult> {
  await provider.detachPaymentMethod(paymentMethodId).catch(() => alertCardNotDetached(bookingId));
  return { ok: false, error };
}

export async function updateBookingCard(
  db: ServiceClient,
  bookingId: string,
  paymentMethodId: string,
): Promise<CardUpdateResult> {
  const booking = await currentCardOf(db, bookingId);
  if (booking?.status !== BookingStatus.PendingMinimum || !booking.customer_external_id) {
    return { ok: false, error: CardUpdateError.Unavailable };
  }

  const provider = getPaymentProvider();
  const card = await provider.getPaymentMethod(paymentMethodId);
  // Una tarjeta de otro customer, o un id que no es el tokenizado, no es nuestra: nunca se toca.
  if (card.customerId !== booking.customer_external_id) {
    alertCardUpdateCustomerMismatch(bookingId);
    return { ok: false, error: CardUpdateError.CardInvalid };
  }
  if (card.id !== paymentMethodId) return { ok: false, error: CardUpdateError.CardInvalid };
  if (card.status === DETACHED_METHOD) return { ok: false, error: CardUpdateError.CardInvalid };
  if (!isComplete(card)) return reject(provider, bookingId, card.id, CardUpdateError.CardInvalid);
  if (card.id === booking.payment_method_id) return { ok: true };

  const { data: outcome, error } = await db.rpc('update_booking_payment_method', {
    p_booking_id: bookingId,
    p_customer_external_id: booking.customer_external_id,
    p_payment_method_id: card.id,
    p_card_brand: card.brand,
    p_card_last4: card.last4 as string,
    p_card_exp_month: card.expMonth as number,
    p_card_exp_year: card.expYear as number,
    p_consent_version: PRIVACY_NOTICE_VERSION,
  });
  // Índice único de …043: la tarjeta ya respalda otra reserva viva, así que no se desvincula.
  if (error?.code === PG_UNIQUE_VIOLATION) return { ok: false, error: CardUpdateError.CardInUse };
  if (error) throw new Error(`update_booking_payment_method: ${error.message}`);
  if (outcome !== UPDATED) {
    const mapped = CARD_UPDATE_OUTCOME_ERRORS[outcome] ?? CardUpdateError.Generic;
    return reject(provider, bookingId, card.id, mapped);
  }

  // Con dos cambios cruzados, la reemplazada puede haber vuelto a ser la vigente: se relee.
  const after = await currentCardOf(db, bookingId);
  const previous = booking.payment_method_id;
  if (previous && after?.payment_method_id === card.id) {
    await provider.detachPaymentMethod(previous).catch(() => alertCardNotDetached(bookingId));
  }
  return { ok: true };
}
