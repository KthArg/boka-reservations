'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import {
  checkoutLocale,
  holdSessionCookieOptions,
  isCheckoutThrottled,
  parseCheckoutInput,
  type CheckoutInput,
} from '@/lib/booking/checkout-input';
import { startDeferredCheckout } from '@/lib/booking/deferred-checkout';
import { completeDeferredCheckout } from '@/lib/booking/deferred-checkout-complete';
import { isDeferredChargeEnabled } from '@/lib/booking/deferred-flag';
import { HOLD_SESSION_COOKIE } from '@shared/constants/bookings';
import {
  checkoutErrorKey,
  CheckoutErrorKey,
  type CheckoutErrorKeyValue,
} from './deferred-checkout-errors';

// Server actions del checkout diferido (spec 0029 §5.2). Activas solo con el flag
// DEFERRED_CHARGE_ENABLED; el paso 2 revalida TODO lo del paso 1, sin confiar en el cliente.

// Ids de OnvoPay: sin `/`, `.` ni `?`, que alterarían la ruta del GET firmado con la secret key.
const PAYMENT_METHOD_ID = /^[A-Za-z0-9_-]{1,100}$/;

const FieldsSchema = z.object({
  instanceId: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  adult: z.number().int(),
  child: z.number().int(),
  student: z.number().int(),
});

// Una server action recibe cualquier cosa: se valida la forma completa antes de tocar nada.
const CompletePayloadSchema = z.object({
  holdId: z.string().uuid(),
  paymentMethodId: z.string().regex(PAYMENT_METHOD_ID),
  expectedAmountCents: z.number().int().positive(),
  fields: FieldsSchema,
});

/** Datos del paso 1 que el cliente reenvía en el paso 2 (se vuelven a validar). */
export type DeferredCheckoutFields = z.infer<typeof FieldsSchema>;
export type DeferredCompletePayload = z.infer<typeof CompletePayloadSchema>;
type CheckoutError = { error: CheckoutErrorKeyValue };

export type DeferredCheckoutStarted = {
  holdId: string;
  customerId: string;
  totalAmountCents: number;
  currency: string;
  fields: DeferredCheckoutFields;
};

export type DeferredStartState = CheckoutError | DeferredCheckoutStarted | null;

const GENERIC: CheckoutError = { error: CheckoutErrorKey.Generic };

function toFields(input: CheckoutInput): DeferredCheckoutFields {
  return {
    instanceId: input.instanceId,
    name: input.customerName,
    email: input.customerEmail,
    ...input.quantities,
  };
}

function fieldGetter(fields: DeferredCheckoutFields) {
  const values: Record<string, string> = {
    instance_id: fields.instanceId,
    name: fields.name,
    email: fields.email,
    // El consentimiento ya se exigió en el paso 1 y se estampa con la versión vigente al crear.
    consent: 'accepted',
    adult: String(fields.adult),
    child: String(fields.child),
    student: String(fields.student),
  };
  return (key: string) => values[key] ?? null;
}

export async function startDeferredCheckoutAction(
  _prev: DeferredStartState,
  formData: FormData,
): Promise<DeferredStartState> {
  if (!isDeferredChargeEnabled()) return GENERIC;

  const input = parseCheckoutInput((key) => formData.get(key));
  if (!input) return GENERIC;
  // Antes de crear hold y customer: el throttle no revela nada ni crea inventario.
  if (await isCheckoutThrottled()) return GENERIC;

  try {
    const sessionToken = crypto.randomUUID();
    const started = await startDeferredCheckout({
      ...input,
      sessionToken,
      locale: await checkoutLocale(),
    });
    (await cookies()).set(HOLD_SESSION_COOKIE, sessionToken, holdSessionCookieOptions());
    return { ...started, fields: toFields(input) };
  } catch (err) {
    // PRIV-06 (spec 0023): solo el mensaje, nunca el objeto (puede embeber PII).
    console.error('[deferred-checkout] start:', err instanceof Error ? err.message : '');
    return { error: checkoutErrorKey(err) };
  }
}

export async function completeDeferredCheckoutAction(
  payload: DeferredCompletePayload,
): Promise<{ bookingId: string } | CheckoutError> {
  if (!isDeferredChargeEnabled()) return GENERIC;

  const parsed = CompletePayloadSchema.safeParse(payload);
  if (!parsed.success) return GENERIC;
  const input = parseCheckoutInput(fieldGetter(parsed.data.fields));
  if (!input) return GENERIC;

  // La cookie HttpOnly del paso 1 prueba que este navegador es el dueño del hold.
  const sessionToken = (await cookies()).get(HOLD_SESSION_COOKIE)?.value;
  if (!sessionToken) return { error: CheckoutErrorKey.HoldExpired };

  try {
    return await completeDeferredCheckout({
      ...input,
      sessionToken,
      locale: await checkoutLocale(),
      holdId: parsed.data.holdId,
      paymentMethodId: parsed.data.paymentMethodId,
      expectedAmountCents: parsed.data.expectedAmountCents,
    });
  } catch (err) {
    console.error('[deferred-checkout] complete:', err instanceof Error ? err.message : '');
    return { error: checkoutErrorKey(err) };
  }
}
