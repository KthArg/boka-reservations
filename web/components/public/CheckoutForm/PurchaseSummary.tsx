'use client';

import { useTranslations } from 'next-intl';
import { vatIncludedCents } from '@shared/constants/policies';
import { CENTS_PER_UNIT } from '@shared/constants/bookings';
import type { TicketCounts } from './CheckoutDetailsFields';
import styles from './CheckoutForm.module.css';

/** Lo que el resumen necesita del servidor: datos de la salida y del vendedor (spec 0034). */
export type PurchaseSummaryInfo = {
  tourName: string;
  dateLabel: string;
  meetingPoint: string;
  sellerLegalName: string;
  sellerTaxId: string;
  /** Marca del operador: la nombra la casilla de datos personales. */
  brand: string;
  toleranceMinutes: number;
};

type Props = {
  info: PurchaseSummaryInfo;
  quantities: TicketCounts;
  totalCents: number;
};

const usd = (cents: number) => (cents / CENTS_PER_UNIT).toFixed(2);

/**
 * Resumen antes de pagar (textos aprobados §3.1; términos, cláusulas 4 y 5): tour, fecha, punto
 * de encuentro, tiquetes, total con el IVA desglosado, condiciones de cancelación, tolerancia de
 * llegada tarde y vendedor. Es lo que el turista acepta al marcar la casilla de los términos.
 */
export function PurchaseSummary({ info, quantities, totalCents }: Props) {
  const t = useTranslations('checkout');

  return (
    <section className={styles.section} aria-labelledby="purchase-summary-title">
      <h2 id="purchase-summary-title" className={styles.sectionTitle}>
        {t('summary-title')}
      </h2>
      <p className={styles.summaryLine}>
        {t('summary-trip', {
          tour: info.tourName,
          date: info.dateLabel,
          meetingPoint: info.meetingPoint,
        })}
      </p>
      <p className={styles.summaryLine}>{t('summary-tickets', quantities)}</p>
      <p className={styles.summaryLine}>
        <strong>
          {t('summary-total', {
            total: usd(totalCents),
            vat: usd(vatIncludedCents(totalCents)),
          })}
        </strong>
      </p>
      <p className={styles.summaryLine}>{t('summary-cancellation')}</p>
      <p className={styles.summaryLine}>
        {t('summary-tolerance', { minutes: info.toleranceMinutes })}
      </p>
      <p className={styles.summaryLine}>
        {t('summary-seller', { name: info.sellerLegalName, taxId: info.sellerTaxId })}
      </p>
    </section>
  );
}
