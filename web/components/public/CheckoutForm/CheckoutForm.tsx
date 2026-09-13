'use client';

import { useActionState, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import type { PublicPricing } from '@/lib/public/tours';
import { checkoutAction } from '@/lib/booking/checkout-action';
import { calculateTotalCents } from '@/lib/booking/pricing-math';
import { MAX_TICKETS_PER_BOOKING } from '@/lib/booking/quantities';
import { OnvoPaymentWidget } from './OnvoPaymentWidget';
import styles from './CheckoutForm.module.css';

type Props = {
  instanceId: string;
  pricing: PublicPricing[];
};

const TICKET_TYPES = ['adult', 'child', 'student'] as const;

export function CheckoutForm({ instanceId, pricing }: Props) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const [state, action, pending] = useActionState(checkoutAction, null);
  const [quantities, setQuantities] = useState({ adult: 1, child: 0, student: 0 });

  const priceMap = new Map(pricing.map((p) => [p.ticket_type, p.price_usd]));
  const totalCents = calculateTotalCents(
    { adult: quantities.adult, child: quantities.child, student: quantities.student },
    pricing.map((p) => ({ ticket_type: p.ticket_type, price_usd: p.price_usd })),
  );
  const totalDisplay = (totalCents / 100).toFixed(2);

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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('tickets-section')}</h2>
        {TICKET_TYPES.map((type) => {
          const price = priceMap.get(type);
          if (price === undefined) return null;
          return (
            <div key={type} className={styles.ticketRow}>
              <label className={styles.ticketLabel}>
                {t(`ticket-${type}`)} — ${price} USD
              </label>
              <input
                type="number"
                name={type}
                min={0}
                max={MAX_TICKETS_PER_BOOKING}
                value={quantities[type]}
                onChange={(e) =>
                  setQuantities((q) => ({ ...q, [type]: parseInt(e.target.value || '0', 10) }))
                }
                className={styles.qtyInput}
              />
            </div>
          );
        })}
        <p className={styles.total}>
          {t('total-label')}: <strong>${totalDisplay} USD</strong>
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('your-info')}</h2>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="name">
            {t('field-name')}
          </label>
          <input id="name" name="name" type="text" required className={styles.input} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            {t('field-email')}
          </label>
          <input id="email" name="email" type="email" required className={styles.input} />
        </div>
      </section>

      <section className={styles.section}>
        <label className={styles.consent}>
          <input
            type="checkbox"
            name="consent"
            value="accepted"
            required
            className={styles.consentCheckbox}
          />
          <span className={styles.consentText}>
            {t.rich('consent-label', {
              privacy: (chunks) => (
                <a
                  href={`/${locale}/privacy`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.consentLink}
                >
                  {chunks}
                </a>
              ),
              terms: (chunks) => (
                <a
                  href={`/${locale}/terms`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.consentLink}
                >
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      </section>

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
