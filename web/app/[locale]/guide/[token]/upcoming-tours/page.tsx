import { getTranslations } from 'next-intl/server';
import { getGuideUpcomingTours } from '@/lib/guides/guide-view';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import type { Locale } from '@/lib/guides/types';
import styles from './guide.module.css';

type Props = { params: Promise<{ locale: string; token: string }> };

export default async function GuideUpcomingPage({ params }: Props) {
  const { locale, token } = await params;
  const t = await getTranslations('guides');
  const tours = await getGuideUpcomingTours(token, locale as Locale);

  if (tours === null) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t('view-invalid-title')}</h1>
          <p className={styles.muted}>{t('view-invalid-body')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('view-title')}</h1>

      {tours.length === 0 ? (
        <p className={styles.muted}>{t('view-empty')}</p>
      ) : (
        <ul className={styles.list}>
          {tours.map((tour) => {
            const { date, time } = formatOperatorDateTime(tour.startsAt);
            return (
              <li key={tour.instanceId} className={styles.card}>
                <h2 className={styles.tourName}>{tour.tourName}</h2>
                <dl className={styles.meta}>
                  <dt className={styles.metaLabel}>{t('view-date')}</dt>
                  <dd className={styles.metaValue}>
                    {date} · {time}
                  </dd>
                  <dt className={styles.metaLabel}>{t('view-meeting')}</dt>
                  <dd className={styles.metaValue}>{tour.meetingPoint}</dd>
                  <dt className={styles.metaLabel}>{t('view-passengers')}</dt>
                  <dd className={styles.metaValue}>{tour.passengerCount}</dd>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
