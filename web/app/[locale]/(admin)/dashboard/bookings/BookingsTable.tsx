import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BookingStatus } from '@shared/constants/enums';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import type { AdminBookingRow } from '@/lib/booking/admin-types';
import { CheckInButton } from './CheckInButton';
import styles from './bookings.module.css';

type Props = { rows: AdminBookingRow[] };

function badgeClass(status: string): string {
  return status === BookingStatus.Confirmed ? styles.badgeConfirmed : styles.badge;
}

function CheckInCell({ row, checkedInLabel }: { row: AdminBookingRow; checkedInLabel: string }) {
  if (row.status === BookingStatus.Confirmed) {
    return <CheckInButton bookingId={row.id} checkedIn={row.checkedInAt !== null} />;
  }
  return <span className={styles.detailValue}>{row.checkedInAt ? checkedInLabel : '—'}</span>;
}

export async function BookingsTable({ rows }: Props) {
  const t = await getTranslations('bookings');

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.th}>{t('col-date')}</th>
          <th className={styles.th}>{t('col-tour')}</th>
          <th className={styles.th}>{t('col-customer')}</th>
          <th className={styles.th}>{t('col-people')}</th>
          <th className={styles.th}>{t('col-status')}</th>
          <th className={styles.th}>{t('col-payment')}</th>
          <th className={styles.th}>{t('col-checkin')}</th>
          <th className={styles.th}>{t('col-actions')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { date, time } = formatOperatorDateTime(row.startsAt);
          return (
            <tr key={row.id} className={styles.row}>
              <td className={styles.td}>
                {date} {time}
              </td>
              <td className={styles.td}>{row.tourName}</td>
              <td className={styles.td}>{row.customerName}</td>
              <td className={styles.td}>{row.totalTickets}</td>
              <td className={styles.td}>
                <span className={badgeClass(row.status)}>{t(`status-${row.status}`)}</span>
              </td>
              <td className={styles.td}>
                {row.paymentStatus ? t(`payment-${row.paymentStatus}`) : t('payment-none')}
              </td>
              <td className={`${styles.td} ${row.checkedInAt ? styles.checkedIn : ''}`}>
                <CheckInCell row={row} checkedInLabel={t('checkin-yes')} />
              </td>
              <td className={styles.td}>
                <Link href={`/dashboard/bookings/${row.id}`} className={styles.detailLink}>
                  {t('view-detail')}
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
