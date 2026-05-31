import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getBookingDetailForAdmin } from '@/lib/booking/admin-detail';
import { BookingDetailView } from './BookingDetailView';
import styles from '../bookings.module.css';

type Props = { params: Promise<{ id: string }> };

export default async function BookingDetailPage({ params }: Props) {
  const { id } = await params;
  const booking = await getBookingDetailForAdmin(id);

  if (!booking) {
    const t = await getTranslations('bookings');
    return (
      <div className={styles.page}>
        <Link href="/dashboard/bookings" className={styles.backLink}>
          ← {t('detail-back')}
        </Link>
        <p className={styles.empty}>{t('detail-not-found')}</p>
      </div>
    );
  }

  return <BookingDetailView booking={booking} />;
}
