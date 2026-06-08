import { getTranslations } from 'next-intl/server';
import { formatMoneyCents } from '@/lib/format/money';
import { reportTourName, type RevenueRow } from '@/lib/reports/types';
import styles from './reports.module.css';

type Props = { rows: RevenueRow[]; locale: string; exportHref: string };

export async function RevenueSection({ rows, locale, exportHref }: Props) {
  const t = await getTranslations('reports');
  const currency = rows[0]?.currency ?? 'USD';
  const gross = rows.reduce((s, r) => s + r.grossCents, 0);
  const refunded = rows.reduce((s, r) => s + r.refundedCents, 0);
  const money = (c: number) => formatMoneyCents(c, currency, locale);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{t('revenue-title')}</h2>
        <a className={styles.secondaryBtn} href={exportHref}>
          {t('export-csv')}
        </a>
      </div>
      <div className={styles.cards}>
        <div className={styles.card}>
          <p className={styles.cardLabel}>{t('gross')}</p>
          <p className={styles.cardValue}>{money(gross)}</p>
        </div>
        <div className={styles.card}>
          <p className={styles.cardLabel}>{t('refunded')}</p>
          <p className={styles.cardValue}>{money(refunded)}</p>
        </div>
        <div className={styles.card}>
          <p className={styles.cardLabel}>{t('net')}</p>
          <p className={styles.cardValue}>{money(gross - refunded)}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>{t('empty')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('col-tour')}</th>
              <th className={styles.num}>{t('gross')}</th>
              <th className={styles.num}>{t('refunded')}</th>
              <th className={styles.num}>{t('net')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tourId}>
                <td>{reportTourName(r, locale)}</td>
                <td className={styles.num}>{money(r.grossCents)}</td>
                <td className={styles.num}>{money(r.refundedCents)}</td>
                <td className={styles.num}>{money(r.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
