'use server';

import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { initCheckout } from '@/lib/booking/create';
import type { BookingLocale } from '@/lib/booking/create';
import { parseTicketQuantities } from '@/lib/booking/quantities';

const EmailSchema = z.string().email();

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

  // Valida formato del email (spec 0016, B-3): evita reservas con destinatario inválido
  // que nunca recibe su confirmación, e higiene de input.
  if (!customerName || !instanceId || !EmailSchema.safeParse(customerEmail).success) {
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
    });
    return { paymentIntentId: result.externalPaymentId, bookingId: result.bookingId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    console.error('[checkout-action] error:', msg, err);
    if (msg === 'HOLD_NO_CAPACITY') return { error: 'no-availability' };
    return { error: 'error-generic' };
  }
}
