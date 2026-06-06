import { getTranslations } from 'next-intl/server';
import { formatMoneyCents } from '@/lib/format/money';
import { reportTourName, type RevenueRow, type OccupancyRow } from '@/lib/reports/types';
import styles from './reports.module.css';

const TOP_N = 10;
type Props = { revenue: RevenueRow[]; occupancy: OccupancyRow[]; locale: string };

export async function TopToursSection({ revenue, occupancy, locale }: Props) {
  const t = await getTranslations('reports');
  const byNet = [...revenue].sort((a, b) => b.netCents - a.netCents).slice(0, TOP_N);
  const byBookings = [...occupancy]
    .sort((a, b) => b.bookingsCount - a.bookingsCount)
    .slice(0, TOP_N);
  const currency = revenue[0]?.currency ?? 'USD';
  const empty = revenue.length === 0 && occupancy.length === 0;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t('top-title')}</h2>
      {empty ? (
        <p className={styles.empty}>{t('empty')}</p>
      ) : (
        <div className={styles.columns}>
          <div className={styles.column}>
            <p className={styles.columnTitle}>{t('top-by-revenue')}</p>
            <table className={styles.table}>
              <tbody>
                {byNet.map((r) => (
                  <tr key={r.tourId}>
                    <td>{reportTourName(r, locale)}</td>
                    <td className={styles.num}>{formatMoneyCents(r.netCents, currency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.column}>
            <p className={styles.columnTitle}>{t('top-by-bookings')}</p>
            <table className={styles.table}>
              <tbody>
                {byBookings.map((r) => (
                  <tr key={r.tourId}>
                    <td>{reportTourName(r, locale)}</td>
                    <td className={styles.num}>{r.bookingsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
