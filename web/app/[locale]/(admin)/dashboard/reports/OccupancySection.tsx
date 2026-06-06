import { getTranslations } from 'next-intl/server';
import { reportTourName, noShowRate, formatRatioPct, type OccupancyRow } from '@/lib/reports/types';
import styles from './reports.module.css';

type Props = { rows: OccupancyRow[]; locale: string; exportHref: string };

export async function OccupancySection({ rows, locale, exportHref }: Props) {
  const t = await getTranslations('reports');

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{t('occupancy-title')}</h2>
        <a className={styles.secondaryBtn} href={exportHref}>
          {t('export-csv')}
        </a>
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>{t('empty')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('col-tour')}</th>
              <th className={styles.num}>{t('col-bookings')}</th>
              <th className={styles.num}>{t('col-tickets')}</th>
              <th className={styles.num}>{t('col-capacity')}</th>
              <th className={styles.num}>{t('col-occupancy')}</th>
              <th className={styles.num}>{t('col-no-show')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tourId}>
                <td>{reportTourName(r, locale)}</td>
                <td className={styles.num}>{r.bookingsCount}</td>
                <td className={styles.num}>{r.ticketsSold}</td>
                <td className={styles.num}>{r.capacityTotal}</td>
                <td className={styles.num}>{formatRatioPct(r.occupancyPct)}</td>
                <td className={styles.num}>{formatRatioPct(noShowRate(r))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
