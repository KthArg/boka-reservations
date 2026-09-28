import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import type { ReviewBooking } from '@/lib/operations/repository';
import styles from './departures.module.css';

/**
 * Reservas de salidas canceladas por clima o seguridad (spec 0035). No hay reembolso automático:
 * cada una se decide desde su detalle (reembolso del 100 %, otra fecha o ningún reembolso).
 */
export async function ReviewTray({ bookings }: { bookings: ReviewBooking[] }) {
  const t = await getTranslations('operations');
  if (bookings.length === 0) return null;

  return (
    <section className={styles.tray}>
      <h2 className={styles.trayTitle}>{t('review-tray-title')}</h2>
      <p className={styles.trayIntro}>{t('review-tray-intro')}</p>
      <ul className={styles.trayList}>
        {bookings.map((booking) => {
          const { date, time } = formatOperatorDateTime(booking.startsAt);
          return (
            <li key={booking.id} className={styles.trayItem}>
              <div>
                <p className={styles.trayTour}>
                  {booking.tourName} · {booking.customerName}
                </p>
                <p className={styles.trayMeta}>
                  {date} {time}
                  {booking.reason ? ` · ${t(`reason-${booking.reason}`)}` : ''}
                </p>
              </div>
              <Link href={`/dashboard/bookings/${booking.id}`} className={styles.confirmButton}>
                {t('review-open')}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
