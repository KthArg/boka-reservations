'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PublicPricing } from '@/lib/public/tours';
import { MAX_TICKETS_PER_BOOKING } from '@/lib/booking/quantities';
import { NumberField } from '@/components/forms/NumberField';
import { CENTS_PER_UNIT } from '@shared/constants/bookings';
import { ConsentField } from './ConsentField';
import { PurchaseSummary, type PurchaseSummaryInfo } from './PurchaseSummary';
import styles from './CheckoutForm.module.css';

export type TicketCounts = { adult: number; child: number; student: number };

type Props = {
  summary: PurchaseSummaryInfo;
  pricing: PublicPricing[];
  quantities: TicketCounts;
  onQuantitiesChange: (quantities: TicketCounts) => void;
  totalCents: number;
};

const TICKET_TYPES = ['adult', 'child', 'student'] as const;

/**
 * Tickets, datos del turista y consentimiento: las secciones comunes a los dos checkouts
 * (widget y diferido, spec 0029). Solo presenta; el precio autoritativo lo calcula el servidor.
 * Nombre y email con `defaultValue` ligado al estado, para que el reset del form que hace React 19
 * tras la action no borre lo escrito cuando la action devuelve un error.
 */
export function CheckoutDetailsFields({
  summary,
  pricing,
  quantities,
  onQuantitiesChange,
  totalCents,
}: Props) {
  const t = useTranslations('checkout');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const priceMap = new Map(pricing.map((p) => [p.ticket_type, p.price_usd]));
  const totalDisplay = (totalCents / CENTS_PER_UNIT).toFixed(2);

  return (
    <>
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
              <NumberField
                name={type}
                value={quantities[type]}
                onChange={(quantity) => onQuantitiesChange({ ...quantities, [type]: quantity })}
                rule={{ min: 0, max: MAX_TICKETS_PER_BOOKING, integer: true }}
                mode="correct"
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
        <p className={styles.fieldNote}>{t('your-info-note')}</p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="name">
            {t('field-name')}
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={name}
            onChange={(e) => setName(e.target.value)}
            className={styles.input}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            {t('field-email')}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input}
          />
        </div>
      </section>

      <PurchaseSummary info={summary} quantities={quantities} totalCents={totalCents} />

      <ConsentField brand={summary.brand} />
    </>
  );
}
