import { formatMoneyCents } from '@/lib/format/money';
import { BookingStatus } from '@shared/constants/enums';
import { computeRefund } from '@shared/constants/policies';
import type { AdminBookingDetail } from '@/lib/booking/admin-types';
import { CheckInButton } from '../CheckInButton';
import { CancelBookingButton } from '../CancelBookingButton';
import { ManualChargeButton } from '../ManualChargeButton';
import styles from '../bookings.module.css';

type Props = { booking: AdminBookingDetail; locale: string };

/**
 * Acciones del detalle de reserva según su estado: check-in y cancelación con reembolso para una
 * confirmada; cobro manual y cancelación sin costo para una sin cobrar (spec 0029 §5.11).
 */
export function BookingDetailActions({ booking, locale }: Props) {
  const isConfirmed = booking.status === BookingStatus.Confirmed;
  const isUnpaid = booking.status === BookingStatus.PendingMinimum;
  const refundPreview = computeRefund({
    startsAt: new Date(booking.startsAt),
    totalAmountCents: booking.totalAmountCents,
    now: new Date(),
  });
  const refundAmountLabel = refundPreview.eligible
    ? formatMoneyCents(refundPreview.amountCents, booking.currency, locale)
    : null;

  return (
    <div className={styles.headerActions}>
      {isConfirmed ? (
        <>
          <CheckInButton bookingId={booking.id} checkedIn={booking.checkedInAt !== null} />
          <CancelBookingButton bookingId={booking.id} refundAmount={refundAmountLabel} />
        </>
      ) : null}
      {isUnpaid && booking.hasSavedCard ? (
        <ManualChargeButton
          bookingId={booking.id}
          retry={booking.chargeAttempts > 0}
          amount={formatMoneyCents(booking.totalAmountCents, booking.currency, locale)}
        />
      ) : null}
      {isUnpaid ? <CancelBookingButton bookingId={booking.id} refundAmount={null} unpaid /> : null}
    </div>
  );
}
