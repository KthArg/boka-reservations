import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { createHold, releaseHold } from '@/lib/booking/availability';
import { resolveAuthoritativeCharge } from '@/lib/booking/checkout-pricing';
import type { BookingLocale } from '@/lib/booking/create';
import type { CheckoutInput } from '@/lib/booking/checkout-input';
import { getPaymentProvider } from '@/lib/payments';
import { HoldStatus } from '@shared/constants/enums';
import { DeferredCheckoutCode } from './deferred-checkout-errors';
import { alertCustomerCreateFailed, alertOrphanedCustomer } from './deferred-checkout-alerts';
import { CHECKOUT_CURRENCY } from '@shared/constants/bookings';

// Checkout diferido (spec 0029 §5.2): el turista guarda la tarjeta y no se le cobra. Dos pasos,
// porque el navegador tokeniza con el customer que el servidor creó para este hold:
//   1. startDeferredCheckout (acá): hold + customer en OnvoPay, guardado en el hold.
//   2. completeDeferredCheckout (deferred-checkout-complete.ts): lee la tarjeta por GET, verifica
//      que sea de ese customer y crea la reserva de forma atómica.
// PAN, CVV y vencimiento nunca pasan por el servidor.

export const DEFERRED_CURRENCY = CHECKOUT_CURRENCY;

export type DeferredCheckoutParams = CheckoutInput & {
  sessionToken: string;
  locale: BookingLocale;
};

export type DeferredCheckoutStart = {
  holdId: string;
  customerId: string;
  totalAmountCents: number;
  currency: string;
};

function seatsOf(input: CheckoutInput): number {
  return input.quantities.adult + input.quantities.child + input.quantities.student;
}

export async function startDeferredCheckout(
  params: DeferredCheckoutParams,
): Promise<DeferredCheckoutStart> {
  const db = createSupabaseServiceClient();
  // Monto autoritativo server-side (spec 0015): es el que muestra el mandato del paso 2.
  const { totalAmountCents } = await resolveAuthoritativeCharge(
    db,
    params.instanceId,
    params.quantities,
    params.locale,
  );
  const { holdId } = await createHold(params.instanceId, seatsOf(params), params.sessionToken);
  const provider = getPaymentProvider();

  let customerId: string;
  try {
    ({ customerId } = await provider.createCustomer({
      name: params.customerName,
      email: params.customerEmail,
    }));
  } catch (err) {
    alertCustomerCreateFailed(holdId);
    // Si no se libera, el hold vence solo en minutos: no retiene cupo por mucho.
    await releaseHold(holdId).catch(() => undefined);
    throw err;
  }

  try {
    const { data, error } = await db
      .from('tour_holds')
      .update({ customer_external_id: customerId })
      .eq('id', holdId)
      .eq('status', HoldStatus.Active)
      .select('id');
    if (error) throw new Error(error.message);
    // Sin la fila guardada, la limpieza de close-payment-intents nunca encontraría el customer.
    if (data.length !== 1) throw new Error(DeferredCheckoutCode.HoldInvalid);
    return { holdId, customerId, totalAmountCents, currency: DEFERRED_CURRENCY };
  } catch (err) {
    await provider
      .deleteCustomer(customerId)
      .catch(() => alertOrphanedCustomer(customerId, holdId));
    await releaseHold(holdId).catch(() => undefined);
    throw err;
  }
}
