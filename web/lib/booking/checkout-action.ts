'use server';

import { redirect } from 'next/navigation';
import { initCheckout, calculateTotalCents } from '@/lib/booking/create';
import type { PricingRow } from '@/lib/booking/create';
import { env } from '@/lib/env';

export type CheckoutFormState = { error: string } | null;

export async function checkoutAction(
  _prev: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  const instanceId = (formData.get('instance_id') as string | null) ?? '';
  const tourName = (formData.get('tour_name') as string | null) ?? '';
  const customerName = ((formData.get('name') as string | null) ?? '').trim();
  const customerEmail = ((formData.get('email') as string | null) ?? '').trim().toLowerCase();
  const adult = Math.max(0, parseInt((formData.get('adult') as string | null) ?? '0', 10));
  const child = Math.max(0, parseInt((formData.get('child') as string | null) ?? '0', 10));
  const student = Math.max(0, parseInt((formData.get('student') as string | null) ?? '0', 10));
  const pricingRaw = (formData.get('pricing') as string | null) ?? '[]';

  if (!customerName || !customerEmail || !instanceId) return { error: 'error-generic' };
  if (adult + child + student === 0) return { error: 'error-generic' };

  let pricing: PricingRow[];
  try {
    pricing = JSON.parse(pricingRaw) as PricingRow[];
  } catch {
    return { error: 'error-generic' };
  }

  const totalCents = calculateTotalCents({ adult, child, student }, pricing);
  if (totalCents === 0) return { error: 'error-generic' };

  let paymentUrl: string;
  try {
    const result = await initCheckout({
      instanceId,
      sessionToken: crypto.randomUUID(),
      customerName,
      customerEmail,
      quantities: { adult, child, student },
      pricing,
      tourName,
      appUrl: env.APP_URL,
    });
    paymentUrl = result.paymentUrl;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'HOLD_NO_CAPACITY') return { error: 'no-availability' };
    return { error: 'error-generic' };
  }

  redirect(paymentUrl);
}
