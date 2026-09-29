import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import { formatMoneyCents } from '@/lib/format/money';
import type { RefundToResolve } from '@/lib/operations/refund-tray';
import { BOOKINGS_ADMIN_PATH } from '@shared/constants/bookings';
import styles from './departures.module.css';

/**
 * Reembolsos que esperan algo del operador (spec 0038): fallidos, a la espera de una
 * transferencia, o en cola sin avanzar. La bandeja no tiene acciones: cada uno se resuelve desde el
 * detalle de su reserva.
 */
export async function RefundTray({ refunds }: { refunds: RefundToResolve[] }) {
  if (refunds.length === 0) return null;
  const [t, tBookings, locale] = await Promise.all([
    getTranslations('operations'),
    getTranslations('bookings'),
    getLocale(),
  ]);

  return (
    <section className={styles.tray}>
      <h2 className={styles.trayTitle}>{t('refund-tray-title')}</h2>
      <p className={styles.trayIntro}>{t('refund-tray-intro')}</p>
      <ul className={styles.trayList}>
        {refunds.map((refund) => {
          const departure = formatOperatorDateTime(refund.startsAt);
          const since = formatOperatorDateTime(refund.waitingSince);
          return (
            <li key={refund.id} className={styles.trayItem}>
              <div>
                <p className={styles.trayTour}>
                  {refund.tourName} · {refund.customerName}
                </p>
                <p className={styles.trayMeta}>
                  {`${departure.date} ${departure.time} · `}
                  {formatMoneyCents(refund.amountCents, refund.currency, locale)}
                  {` · ${tBookings(`refund-status-${refund.status}`)} · `}
                  {t('refund-tray-since', { date: since.date })}
                </p>
                {refund.failureReason ? (
                  <p className={styles.trayMeta}>{refund.failureReason}</p>
                ) : null}
              </div>
              <Link
                href={`${BOOKINGS_ADMIN_PATH}/${refund.bookingId}`}
                className={styles.confirmButton}
              >
                {t('refund-tray-open')}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
