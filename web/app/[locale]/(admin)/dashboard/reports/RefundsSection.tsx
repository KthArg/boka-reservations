import { getTranslations } from 'next-intl/server';
import { formatMoneyCents } from '@/lib/format/money';
import { cancellationRate, formatRatioPct, type RefundsSummary } from '@/lib/reports/types';
import styles from './reports.module.css';

type Props = { summary: RefundsSummary; locale: string; exportHref: string };

export async function RefundsSection({ summary, locale, exportHref }: Props) {
  const t = await getTranslations('reports');

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{t('refunds-title')}</h2>
        <a className={styles.secondaryBtn} href={exportHref}>
          {t('export-csv')}
        </a>
      </div>
      <div className={styles.cards}>
        <div className={styles.card}>
          <p className={styles.cardLabel}>{t('refunds-count')}</p>
          <p className={styles.cardValue}>{summary.refundsCount}</p>
        </div>
        <div className={styles.card}>
          <p className={styles.cardLabel}>{t('refunds-amount')}</p>
          <p className={styles.cardValue}>
            {formatMoneyCents(summary.refundsAmountCents, summary.currency, locale)}
          </p>
        </div>
        <div className={styles.card}>
          <p className={styles.cardLabel}>{t('cancellation-rate')}</p>
          <p className={styles.cardValue}>{formatRatioPct(cancellationRate(summary))}</p>
        </div>
      </div>
    </section>
  );
}
