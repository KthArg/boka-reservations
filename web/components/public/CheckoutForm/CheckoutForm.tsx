'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicPricing } from '@/lib/public/tours';
import { checkoutAction } from '@/lib/booking/checkout-action';
import { calculateTotalCents, initialQuantities } from '@/lib/booking/pricing-math';
import { formatAmountCents } from '@/lib/format/money';
import { HOLD_TTL_MINUTES } from '@shared/constants/bookings';
import { CaptchaAction } from '@shared/constants/captcha';
import { CheckoutDetailsFields, type TicketCounts } from './CheckoutDetailsFields';
import type { PurchaseSummaryInfo } from './PurchaseSummary';
import { OnvoPaymentWidget } from './OnvoPaymentWidget';
import styles from './CheckoutForm.module.css';

type Props = {
  instanceId: string;
  pricing: PublicPricing[];
  summary: PurchaseSummaryInfo;
  /** Sitekey de Turnstile, o null con el captcha apagado (spec 0048, Fase B). */
  captchaSiteKey: string | null;
};

/** Checkout con el widget de OnvoPay: cobra al reservar (flujo sin cobro diferido). */
export function CheckoutForm({ instanceId, pricing, summary, captchaSiteKey }: Props) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const [state, action, pending] = useActionState(checkoutAction, null);
  const [quantities, setQuantities] = useState<TicketCounts>(() => initialQuantities(pricing));
  const [captchaPending, setCaptchaPending] = useState(false);

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
      <input type="hidden" name="expected_amount_cents" value={totalCents} />
      <CheckoutDetailsFields
        summary={summary}
        pricing={pricing}
        quantities={quantities}
        onQuantitiesChange={setQuantities}
        totalCents={totalCents}
        captcha={
          captchaSiteKey
            ? {
                siteKey: captchaSiteKey,
                action: CaptchaAction.Checkout,
                resetKey: state,
                onPendingChange: setCaptchaPending,
              }
            : null
        }
      />

      {state && 'error' in state && (
        <p className={styles.error} role="alert">
          {t(state.error as Parameters<typeof t>[0])}
        </p>
      )}

      <p className={styles.fieldNote}>{t('hold-notice', { minutes: HOLD_TTL_MINUTES })}</p>

      <button
        type="submit"
        disabled={pending || captchaPending || totalCents === 0}
        className={styles.submit}
      >
        {pending
          ? t('submitting')
          : captchaPending
            ? t('captcha-verifying')
            : t('submit', { amount: formatAmountCents(totalCents, locale) })}
      </button>
    </form>
  );
}
