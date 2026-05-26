import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { listTours } from '@/lib/tours/repository';
import { archiveTour, reactivateTour } from '@/lib/tours/actions';
import { TourStatus } from '@shared/constants/enums';
import styles from './tours.module.css';

export default async function ToursPage() {
  const [tours, t] = await Promise.all([listTours(), getTranslations('tours')]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('page-title')}</h1>
        <Link href="/dashboard/tours/new" className={styles.newBtn}>
          {t('new-tour')}
        </Link>
      </div>

      {tours.length === 0 ? (
        <p className={styles.empty}>{t('no-tours')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>{t('col-name')}</th>
              <th className={styles.th}>{t('col-status')}</th>
              <th className={styles.th}>{t('col-duration')}</th>
              <th className={styles.th}>{t('col-schedules')}</th>
              <th className={styles.th}>{t('col-actions')}</th>
            </tr>
          </thead>
          <tbody>
            {tours.map((tour) => (
              <tr key={tour.id} className={styles.row}>
                <td className={styles.td}>{tour.name_es}</td>
                <td className={styles.td}>
                  <span
                    className={
                      tour.status === TourStatus.Active ? styles.badgeActive : styles.badgeArchived
                    }
                  >
                    {tour.status === TourStatus.Active ? t('status-active') : t('status-archived')}
                  </span>
                </td>
                <td className={styles.td}>{tour.duration_minutes} min</td>
                <td className={styles.td}>{tour.activeSchedulesCount}</td>
                <td className={`${styles.td} ${styles.actions}`}>
                  <Link href={`/dashboard/tours/${tour.id}/edit`} className={styles.editBtn}>
                    {t('edit')}
                  </Link>
                  {tour.status === TourStatus.Active ? (
                    <form action={archiveTour.bind(null, tour.id)}>
                      <button type="submit" className={styles.archiveBtn}>
                        {t('archive')}
                      </button>
                    </form>
                  ) : (
                    <form action={reactivateTour.bind(null, tour.id)}>
                      <button type="submit" className={styles.reactivateBtn}>
                        {t('reactivate')}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
