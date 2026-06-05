import { getTranslations, getLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import { formatMoneyCents } from '@/lib/format/money';
import { BookingStatus } from '@shared/constants/enums';
import { RefundStatus } from '@shared/constants/refunds';
import { CENTS_PER_UNIT } from '@shared/constants/bookings';
import { computeRefund } from '@shared/constants/policies';
import type { AdminBookingDetail } from '@/lib/booking/admin-types';
import { CheckInButton } from '../CheckInButton';
import { CancelBookingButton } from '../CancelBookingButton';
import { RetryRefundButton } from '../RetryRefundButton';
import styles from '../bookings.module.css';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
    </>
  );
}

export async function BookingDetailView({ booking }: { booking: AdminBookingDetail }) {
  const [t, locale] = await Promise.all([getTranslations('bookings'), getLocale()]);
  const start = formatOperatorDateTime(booking.startsAt);
  const checkIn = formatOperatorDateTime(booking.checkedInAt ?? '');
  const created = formatOperatorDateTime(booking.createdAt);
  const amount = (booking.totalAmountCents / CENTS_PER_UNIT).toFixed(2);

  const isConfirmed = booking.status === BookingStatus.Confirmed;
  const refundPreview = computeRefund({
    startsAt: new Date(booking.startsAt),
    totalAmountCents: booking.totalAmountCents,
    now: new Date(),
  });
  const refundAmountLabel = refundPreview.eligible
    ? formatMoneyCents(refundPreview.amountCents, booking.currency, locale)
    : null;

  return (
    <div className={styles.page}>
      <Link href="/dashboard/bookings" className={styles.backLink}>
        ← {t('detail-back')}
      </Link>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('detail-title')}</h1>
        <div className={styles.headerActions}>
          {isConfirmed ? (
            <CheckInButton bookingId={booking.id} checkedIn={booking.checkedInAt !== null} />
          ) : null}
          {isConfirmed ? (
            <CancelBookingButton bookingId={booking.id} refundAmount={refundAmountLabel} />
          ) : null}
        </div>
      </div>

      <div className={styles.detailGrid}>
        <Row label={t('detail-customer')} value={booking.customerName} />
        <Row label={t('detail-email')} value={booking.customerEmail} />
        <Row label={t('detail-tour')} value={booking.tourName} />
        <Row label={t('detail-date')} value={`${start.date} ${start.time}`} />
        <Row label={t('detail-adult')} value={String(booking.ticketsAdult)} />
        <Row label={t('detail-child')} value={String(booking.ticketsChild)} />
        <Row label={t('detail-student')} value={String(booking.ticketsStudent)} />
        <Row label={t('detail-amount')} value={`${amount} ${booking.currency}`} />
        <Row label={t('detail-status')} value={t(`status-${booking.status}`)} />
        <Row
          label={t('detail-payment')}
          value={booking.paymentStatus ? t(`payment-${booking.paymentStatus}`) : t('payment-none')}
        />
        <Row label={t('detail-provider')} value={booking.paymentProvider ?? '—'} />
        <Row
          label={t('detail-checkin')}
          value={booking.checkedInAt ? `${checkIn.date} ${checkIn.time}` : t('checkin-no')}
        />
        <Row label={t('detail-created')} value={`${created.date} ${created.time}`} />
      </div>

      {booking.refund ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('detail-refund')}</h2>
          <div className={styles.refundRow}>
            <span>{t(`refund-status-${booking.refund.status}`)}</span>
            {booking.refund.status === RefundStatus.Failed ? (
              <RetryRefundButton refundId={booking.refund.id} />
            ) : null}
          </div>
          {booking.refund.failureReason ? (
            <p className={styles.empty}>{booking.refund.failureReason}</p>
          ) : null}
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('detail-notifications')}</h2>
        {booking.notifications.length === 0 ? (
          <p className={styles.empty}>{t('detail-no-notifications')}</p>
        ) : (
          <table className={styles.table}>
            <tbody>
              {booking.notifications.map((n, i) => {
                const sent = formatOperatorDateTime(n.sentAt ?? '');
                return (
                  <tr key={`${n.kind}-${i}`} className={styles.row}>
                    <td className={styles.td}>{t(`notif-${n.kind}`)}</td>
                    <td className={styles.td}>{n.status}</td>
                    <td className={styles.td}>{n.sentAt ? `${sent.date} ${sent.time}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
