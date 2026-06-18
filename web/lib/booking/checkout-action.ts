'use server';

import { getLocale } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { initCheckout } from '@/lib/booking/create';
import type { BookingLocale } from '@/lib/booking/create';
import { parseTicketQuantities } from '@/lib/booking/quantities';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';
import { rateLimitKey } from '@/lib/security/rate-limit-key';
import { RATE_LIMITS, RATE_LIMIT_KEY_PREFIX } from '@shared/constants/rate-limit';

const EmailSchema = z.string().email();
// APPSEC-02 (spec 0023): cota de longitud del nombre (higiene de input; evita persistir e
// inyectar en el email un nombre de varios MB). El endpoint de checkout es público.
const NameSchema = z.string().trim().min(1).max(120);
// ACCESS-03 (spec 0023): cookie HttpOnly con el session_token del hold; la página de
// cancelación la usa para probar propiedad antes de liberar el hold. Vida ~ hold (15 min) + margen.
const HOLD_SESSION_COOKIE = 'hold_session';
const HOLD_SESSION_MAX_AGE_S = 20 * 60;

/**
 * Rate limit del checkout por IP (spec 0017): acota la frecuencia de holds para que un
 * atacante no automatice checkouts y secuestre el cupo de las salidas (cada checkout
 * reserva cupo por 15 min y genera un payment intent en OnvoPay). Complementa el tope de
 * cantidades del 0015 (que acota una sola request) limitando la frecuencia.
 */
async function isCheckoutThrottled(): Promise<boolean> {
  const ip = getClientIp(await headers());
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
    !NameSchema.safeParse(customerName).success ||
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
    const sessionToken = crypto.randomUUID();
    const result = await initCheckout({
      instanceId,
      sessionToken,
      customerName,
      customerEmail,
      quantities,
      locale,
      consentAccepted,
    });
    // ACCESS-03: liga el hold a esta sesión de browser (cookie HttpOnly), para que solo quien
    // hizo el checkout pueda liberar el hold desde /checkout/cancel (no cualquiera con el UUID).
    (await cookies()).set(HOLD_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: HOLD_SESSION_MAX_AGE_S,
    });
    return { paymentIntentId: result.externalPaymentId, bookingId: result.bookingId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    // PRIV-06 (spec 0023): no volcar el objeto `err` completo (puede embeber PII de DB/OnvoPay).
    console.error('[checkout-action] error:', msg);
    if (msg === 'HOLD_NO_CAPACITY') return { error: 'no-availability' };
    return { error: 'error-generic' };
  }
}
