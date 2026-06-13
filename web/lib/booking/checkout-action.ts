'use server';

import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { initCheckout } from '@/lib/booking/create';
import type { BookingLocale } from '@/lib/booking/create';
import { parseTicketQuantities } from '@/lib/booking/quantities';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';
import { rateLimitKey } from '@/lib/security/rate-limit-key';
import { RATE_LIMITS, RATE_LIMIT_KEY_PREFIX } from '@shared/constants/rate-limit';

const EmailSchema = z.string().email();

/**
 * Rate limit del checkout por IP (spec 0017): acota la frecuencia de holds para que un
 * atacante no automatice checkouts y secuestre el cupo de las salidas (cada checkout
 * reserva cupo por 15 min y genera un payment intent en OnvoPay). Complementa el tope de
 * cantidades del 0015 (que acota una sola request) limitando la frecuencia.
 */
async function isCheckoutThrottled(): Promise<boolean> {
  const ip = getClientIp((await headers()).get('x-forwarded-for'));
  const result = await checkRateLimit(
    rateLimitKey(RATE_LIMIT_KEY_PREFIX.checkoutIp, ip),
    RATE_LIMITS.checkoutPerIp.limit,
    RATE_LIMITS.checkoutPerIp.windowSeconds,
  );
  return !result.ok;
}

export type CheckoutFormState =
  | { error: string }
  | { paymentIntentId: string; bookingId: string }
  | null;

export async function checkoutAction(
  _prev: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  const instanceId = (formData.get('instance_id') as string | null) ?? '';
  const customerName = ((formData.get('name') as string | null) ?? '').trim();
  const customerEmail = ((formData.get('email') as string | null) ?? '').trim().toLowerCase();

  // Consentimiento obligatorio (spec 0021, P1-3): se exige server-side, sin confiar en el
  // atributo `required` del cliente. Se valida ANTES de rate-limit/hold/booking para que una
  // request sin consentimiento no consuma cupo ni cree inventario. El checkbox solo llega
  // presente en el FormData cuando el turista lo marcó.
  const consentAccepted = formData.get('consent') != null;

  // Valida formato del email (spec 0016, B-3): evita reservas con destinatario inválido
  // que nunca recibe su confirmación, e higiene de input.
  if (
    !consentAccepted ||
    !customerName ||
    !instanceId ||
    !EmailSchema.safeParse(customerEmail).success
  ) {
    return { error: 'error-generic' };
  }

  // Cantidades validadas server-side (enteros, tope, total > 0). El precio NO viene del
  // cliente: lo recalcula initCheckout desde tour_pricing (spec 0015).
  const quantities = parseTicketQuantities({
    adult: formData.get('adult'),
    child: formData.get('child'),
    student: formData.get('student'),
  });
  if (!quantities) return { error: 'error-generic' };

  // Antes de crear hold/booking/payment: si se excedió el límite por IP, error genérico
  // sin tocar nada (no revela el throttle ni crea inventario reservado).
  if (await isCheckoutThrottled()) return { error: 'error-generic' };

  const rawLocale = await getLocale();
  const locale: BookingLocale = rawLocale === 'en' ? 'en' : 'es';

  try {
    const result = await initCheckout({
      instanceId,
      sessionToken: crypto.randomUUID(),
      customerName,
      customerEmail,
      quantities,
      locale,
      consentAccepted,
    });
    return { paymentIntentId: result.externalPaymentId, bookingId: result.bookingId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    console.error('[checkout-action] error:', msg, err);
    if (msg === 'HOLD_NO_CAPACITY') return { error: 'no-availability' };
    return { error: 'error-generic' };
  }
}
