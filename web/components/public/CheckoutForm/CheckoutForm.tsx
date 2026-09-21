'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PublicPricing } from '@/lib/public/tours';
import { checkoutAction } from '@/lib/booking/checkout-action';
import { calculateTotalCents } from '@/lib/booking/pricing-math';
import { CheckoutDetailsFields, type TicketCounts } from './CheckoutDetailsFields';
import { OnvoPaymentWidget } from './OnvoPaymentWidget';
import styles from './CheckoutForm.module.css';

type Props = {
  instanceId: string;
  pricing: PublicPricing[];
};

const INITIAL_QUANTITIES: TicketCounts = { adult: 1, child: 0, student: 0 };

/** Checkout con el widget de OnvoPay: cobra al reservar (flujo sin cobro diferido). */
export function CheckoutForm({ instanceId, pricing }: Props) {
  const t = useTranslations('checkout');
  const [state, action, pending] = useActionState(checkoutAction, null);
  const [quantities, setQuantities] = useState<TicketCounts>(INITIAL_QUANTITIES);

  const totalCents = calculateTotalCents(
    quantities,
    pricing.map((p) => ({ ticket_type: p.ticket_type, price_usd: p.price_usd })),
  );

  const paymentState = state && 'paymentIntentId' in state ? state : null;

  if (paymentState) {
    return (
      <OnvoPaymentWidget
        paymentIntentId={paymentState.paymentIntentId}
        bookingId={paymentState.bookingId}
      />
    );
  }

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="instance_id" value={instanceId} />
      <CheckoutDetailsFields
        pricing={pricing}
        quantities={quantities}
        onQuantitiesChange={setQuantities}
        totalCents={totalCents}
      />

      {state && 'error' in state && (
        <p className={styles.error} role="alert">
          {t(state.error as Parameters<typeof t>[0])}
        </p>
      )}

      <button type="submit" disabled={pending || totalCents === 0} className={styles.submit}>
        {pending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
