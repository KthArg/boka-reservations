'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PublicPricing } from '@/lib/public/tours';
import { checkoutAction } from '@/lib/booking/checkout-action';
import { calculateTotalCents } from '@/lib/booking/create';
import styles from './CheckoutForm.module.css';

type Props = {
  instanceId: string;
  tourName: string;
  pricing: PublicPricing[];
  tourSlug: string;
};

const TICKET_TYPES = ['adult', 'child', 'student'] as const;

export function CheckoutForm({ instanceId, tourName, pricing, tourSlug }: Props) {
  const t = useTranslations('checkout');
  const [state, action, pending] = useActionState(checkoutAction, null);

  const [quantities, setQuantities] = useState({ adult: 1, child: 0, student: 0 });

  const priceMap = new Map(pricing.map((p) => [p.ticket_type, p.price_usd]));
  const totalCents = calculateTotalCents(
    { adult: quantities.adult, child: quantities.child, student: quantities.student },
    pricing.map((p) => ({ ticket_type: p.ticket_type, price_usd: p.price_usd })),
  );
  const totalDisplay = (totalCents / 100).toFixed(2);

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="instance_id" value={instanceId} />
      <input type="hidden" name="tour_name" value={tourName} />
      <input
        type="hidden"
        name="pricing"
        value={JSON.stringify(
          pricing.map((p) => ({ ticket_type: p.ticket_type, price_usd: p.price_usd })),
        )}
      />

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
                max={20}
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

      {state?.error && (
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
