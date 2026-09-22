import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getBookingDetailForAdmin } from '@/lib/booking/admin-detail';
import { getSession } from '@/lib/auth/server';
import { UserRole } from '@shared/constants/enums';
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

  // Spec 0032: solo un admin reembolsa el total de una salida que ya empezó.
  const isAdmin = (await getSession())?.userRole === UserRole.Admin;
  return <BookingDetailView booking={booking} isAdmin={isAdmin} />;
}
