import 'server-only';
import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import type { BookingLocale } from '@/lib/booking/create';
import { parseTicketQuantities, type TicketQuantities } from '@/lib/booking/quantities';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';
import { rateLimitKey } from '@/lib/security/rate-limit-key';
import {
  RATE_LIMITS,
  RATE_LIMIT_KEY_PREFIX,
  type RateLimitRule,
} from '@shared/constants/rate-limit';

type RateLimitPrefix = (typeof RATE_LIMIT_KEY_PREFIX)[keyof typeof RATE_LIMIT_KEY_PREFIX];
import { CHECKOUT_ACCEPTED_VALUE, CheckoutLegalField } from '@shared/constants/legal';

// Validación y protecciones compartidas por los dos checkouts (widget y diferido, spec 0029).
// Extraído de checkout-action.ts para no duplicar las reglas de 0015, 0016, 0017, 0021 y 0023.

const EmailSchema = z.string().email();
// APPSEC-02 (spec 0023): cota de longitud del nombre (higiene de input).
const NameSchema = z.string().trim().min(1).max(120);
// ACCESS-03 (spec 0023): vida de la cookie que prueba la propiedad del hold ~ hold (15 min)
// + margen.
const HOLD_SESSION_MAX_AGE_S = 20 * 60;

export type CheckoutInput = {
  instanceId: string;
  customerName: string;
  customerEmail: string;
  quantities: TicketQuantities;
};

type FieldGetter = (key: string) => FormDataEntryValue | null;

/**
 * Las dos casillas legales, marcadas por separado (specs 0021 y 0031). Se verifican antes que el
 * resto para responder con su propio mensaje: el navegador ya las exige, así que llegar acá sin
 * ellas es un envío manipulado o un formulario viejo.
 */
export function hasLegalAcceptance(get: FieldGetter): boolean {
  return (
    get(CheckoutLegalField.Terms) === CHECKOUT_ACCEPTED_VALUE &&
    get(CheckoutLegalField.PrivacyConsent) === CHECKOUT_ACCEPTED_VALUE
  );
}

/**
 * Valida los datos del formulario del checkout. Aceptación de términos y consentimiento de
 * datos obligatorios server-side, cada uno por separado (specs 0021 y 0031); email con formato
 * (0016, B-3); cantidades enteras con tope (0015). Devuelve null ante cualquier dato inválido.
 */
export function parseCheckoutInput(get: FieldGetter): CheckoutInput | null {
  const instanceId = String(get('instance_id') ?? '');
  const customerName = String(get('name') ?? '').trim();
  const customerEmail = String(get('email') ?? '')
    .trim()
    .toLowerCase();
  const termsAccepted = get(CheckoutLegalField.Terms) === CHECKOUT_ACCEPTED_VALUE;
  const privacyAccepted = get(CheckoutLegalField.PrivacyConsent) === CHECKOUT_ACCEPTED_VALUE;

  if (
    !termsAccepted ||
    !privacyAccepted ||
    !instanceId ||
    !NameSchema.safeParse(customerName).success ||
    !EmailSchema.safeParse(customerEmail).success
  ) {
    return null;
  }

  const quantities = parseTicketQuantities({
    adult: get('adult'),
    child: get('child'),
    student: get('student'),
  });
  return quantities ? { instanceId, customerName, customerEmail, quantities } : null;
}

/**
 * Rate limit del checkout por IP (spec 0017): acota la frecuencia de holds para que no se
 * automaticen checkouts que secuestren el cupo de las salidas.
 */
export async function isCheckoutThrottled(): Promise<boolean> {
  return isIpThrottled(RATE_LIMIT_KEY_PREFIX.checkoutIp, RATE_LIMITS.checkoutPerIp);
}

/** Paso 1 del diferido: el límite del checkout más un techo diario por IP (spec 0048). */
export async function isDeferredStartThrottled(): Promise<boolean> {
  // El diario cuenta solo los intentos que pasan el de 10 minutos. Si contara también los frenados,
  // quien martille desde una IP móvil compartida (CGNAT) lo agotaría en segundos y dejaría sin
  // checkout a todos los turistas de esa IP hasta el día siguiente.
  if (await isCheckoutThrottled()) return true;
  return isIpThrottled(
    RATE_LIMIT_KEY_PREFIX.deferredStartIpDay,
    RATE_LIMITS.deferredStartPerIpDaily,
  );
}

/** Paso 2 del diferido por IP (spec 0048): antes del GET a OnvoPay. */
export async function isDeferredCompleteThrottled(): Promise<boolean> {
  return isIpThrottled(RATE_LIMIT_KEY_PREFIX.deferredCompleteIp, RATE_LIMITS.deferredCompletePerIp);
}

async function isIpThrottled(prefix: RateLimitPrefix, rule: RateLimitRule): Promise<boolean> {
  const ip = getClientIp(await headers());
  const result = await checkRateLimit(rateLimitKey(prefix, ip), rule.limit, rule.windowSeconds);
  return !result.ok;
}

export async function checkoutLocale(): Promise<BookingLocale> {
  return (await getLocale()) === 'en' ? 'en' : 'es';
}

/** Opciones de la cookie HttpOnly que liga el hold a la sesión del navegador (ACCESS-03). */
export function holdSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: HOLD_SESSION_MAX_AGE_S,
  };
}
