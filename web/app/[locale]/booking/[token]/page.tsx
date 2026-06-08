import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { validateBookingToken } from '@/lib/booking/access-token';
import { getBookingView } from '@/lib/booking/cancel';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import { BookingStatus } from '@shared/constants/enums';
import styles from './booking.module.css';

type Props = { params: Promise<{ locale: string; token: string }> };

export default async function BookingViewPage({ params }: Props) {
  const { locale, token } = await params;
  const t = await getTranslations('cancellation');

  const db = createSupabaseServiceClient();
  const bookingId = await validateBookingToken(db, token);
  const view = bookingId ? await getBookingView(db, bookingId) : null;

  if (!view) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t('title')}</h1>
          <p className={styles.muted}>{t('error-invalid')}</p>
        </div>
      </main>
    );
  }

  const tourName = locale === 'es' ? view.tourNameEs : view.tourNameEn;
  const { date, time } = formatOperatorDateTime(view.startsAt);
  const people = view.ticketsAdult + view.ticketsChild + view.ticketsStudent;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('title')}</h1>
        <dl className={styles.meta}>
          <dt className={styles.metaLabel}>{t('tour')}</dt>
          <dd className={styles.metaValue}>{tourName}</dd>
          <dt className={styles.metaLabel}>{t('date')}</dt>
          <dd className={styles.metaValue}>
            {date} · {time}
          </dd>
          <dt className={styles.metaLabel}>{t('people')}</dt>
          <dd className={styles.metaValue}>{people}</dd>
          <dt className={styles.metaLabel}>{t('status')}</dt>
          <dd className={styles.metaValue}>{t(`status-${view.status}`)}</dd>
        </dl>

        {view.status === BookingStatus.Confirmed ? (
          <Link href={`/booking/${token}/cancel`} className={styles.dangerLink}>
            {t('cancel-cta')}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
