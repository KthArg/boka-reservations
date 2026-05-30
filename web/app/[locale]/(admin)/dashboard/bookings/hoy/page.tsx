import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { listTodayInstances } from '@/lib/booking/admin-detail';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import styles from '../bookings.module.css';

export default async function TodayPage() {
  const t = await getTranslations('bookings');
  const instances = await listTodayInstances();
  const today = formatOperatorDateTime(new Date().toISOString()).date;

  return (
    <div className={styles.page}>
      <Link href="/dashboard/bookings" className={styles.backLink}>
        ← {t('detail-back')}
      </Link>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('today-title')}</h1>
      </div>

      {instances.length === 0 ? (
        <p className={styles.empty}>{t('today-empty')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>{t('today-time')}</th>
              <th className={styles.th}>{t('today-tour')}</th>
              <th className={styles.th}>{t('today-capacity')}</th>
              <th className={styles.th}>{t('today-confirmed')}</th>
              <th className={styles.th}>{t('today-checkedin')}</th>
              <th className={styles.th}>{t('col-actions')}</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((inst) => {
              const { time } = formatOperatorDateTime(inst.startsAt);
              const href = `/dashboard/bookings?tourId=${inst.tourId}&dateFrom=${today}&dateTo=${today}`;
              return (
                <tr key={inst.id} className={styles.row}>
                  <td className={styles.td}>{time}</td>
                  <td className={styles.td}>{inst.tourName}</td>
                  <td className={styles.td}>{inst.capacityTotal}</td>
                  <td className={styles.td}>{inst.confirmedTickets}</td>
                  <td className={styles.td}>{inst.checkedInCount}</td>
                  <td className={styles.td}>
                    <Link href={href} className={styles.detailLink}>
                      {t('today-view')}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
