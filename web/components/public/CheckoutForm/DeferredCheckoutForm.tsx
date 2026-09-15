'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PublicPricing } from '@/lib/public/tours';
import { startDeferredCheckoutAction } from '@/lib/booking/deferred-checkout-action';
import { calculateTotalCents } from '@/lib/booking/pricing-math';
import { CheckoutDetailsFields, type TicketCounts } from './CheckoutDetailsFields';
import { CardDetailsForm } from './CardDetailsForm';
import styles from './CheckoutForm.module.css';
import deferredStyles from './DeferredCheckout.module.css';

type Props = {
  instanceId: string;
  pricing: PublicPricing[];
};

const INITIAL_QUANTITIES: TicketCounts = { adult: 1, child: 0, student: 0 };

/**
 * Checkout diferido (spec 0029 §5.2). Remontar los pasos con otra `key` reinicia el checkout
 * desde el paso 1 cuando la reserva temporal venció o el monto autorizado ya no vale.
 */
export function DeferredCheckoutForm(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return (
    <DeferredCheckoutSteps
      key={attempt}
      {...props}
      onRestart={() => setAttempt((current) => current + 1)}
    />
  );
}

/** Paso 1: tickets, datos y consentimiento. El servidor crea el hold y el customer. */
function DeferredCheckoutSteps({
  instanceId,
  pricing,
  onRestart,
}: Props & { onRestart: () => void }) {
  const t = useTranslations('checkout');
  const [state, action, pending] = useActionState(startDeferredCheckoutAction, null);
  const [quantities, setQuantities] = useState<TicketCounts>(INITIAL_QUANTITIES);

  const totalCents = calculateTotalCents(
    quantities,
    pricing.map((p) => ({ ticket_type: p.ticket_type, price_usd: p.price_usd })),
  );

  if (state && 'holdId' in state) return <CardDetailsForm checkout={state} onRestart={onRestart} />;

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="instance_id" value={instanceId} />
      <CheckoutDetailsFields
        pricing={pricing}
        quantities={quantities}
        onQuantitiesChange={setQuantities}
        totalCents={totalCents}
      />

      <p className={deferredStyles.note}>{t('deferred-no-charge-note')}</p>

      {state && 'error' in state && (
        <p className={styles.error} role="alert">
          {t(state.error)}
        </p>
      )}

      <button type="submit" disabled={pending || totalCents === 0} className={styles.submit}>
        {pending ? t('deferred-submitting') : t('deferred-submit')}
      </button>
    </form>
  );
}
