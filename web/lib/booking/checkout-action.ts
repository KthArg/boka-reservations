'use server';

import { cookies } from 'next/headers';
import { initCheckout } from '@/lib/booking/create';
import {
  checkoutLocale,
  holdSessionCookieOptions,
  isCheckoutThrottled,
  parseCheckoutInput,
} from '@/lib/booking/checkout-input';
import { isDeferredChargeEnabled } from '@/lib/booking/deferred-flag';
import { checkoutErrorKey, CheckoutErrorKey } from '@/lib/booking/deferred-checkout-errors';
import { HOLD_SESSION_COOKIE } from '@shared/constants/bookings';

export type CheckoutFormState =
  | { error: string }
  | { paymentIntentId: string; bookingId: string }
  | null;

export async function checkoutAction(
  _prev: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  // Con el cobro diferido activo (spec 0029 §11) el checkout con widget no se ofrece: invocarlo
  // directo cobraría de inmediato una reserva que tiene que esperar el mínimo.
  if (isDeferredChargeEnabled()) return { error: CheckoutErrorKey.Generic };

  // Consentimiento, nombre, email y cantidades se validan server-side ANTES de rate-limit,
  // hold y booking, para que una request inválida no consuma cupo ni cree inventario
  // (specs 0015, 0016, 0021, 0023; reglas en checkout-input.ts).
  const input = parseCheckoutInput((key) => formData.get(key));
  if (!input) return { error: CheckoutErrorKey.Generic };

  // Antes de crear hold/booking/payment: si se excedió el límite por IP, error genérico
  // sin tocar nada (no revela el throttle ni crea inventario reservado).
  if (await isCheckoutThrottled()) return { error: CheckoutErrorKey.Generic };

  try {
    const sessionToken = crypto.randomUUID();
    const result = await initCheckout({
      ...input,
      sessionToken,
      locale: await checkoutLocale(),
      consentAccepted: true,
    });
    // ACCESS-03: liga el hold a esta sesión de browser (cookie HttpOnly), para que solo quien
    // hizo el checkout pueda liberar el hold desde /checkout/cancel (no cualquiera con el UUID).
    (await cookies()).set(HOLD_SESSION_COOKIE, sessionToken, holdSessionCookieOptions());
    return { paymentIntentId: result.externalPaymentId, bookingId: result.bookingId };
  } catch (err) {
    // PRIV-06 (spec 0023): no volcar el objeto `err` completo (puede embeber PII de DB/OnvoPay).
    console.error('[checkout-action] error:', err instanceof Error ? err.message : '');
    // Sin cupo y salida ya ocurrida (spec 0028, B7) tienen mensaje propio; el resto es genérico.
    return { error: checkoutErrorKey(err) };
  }
}
