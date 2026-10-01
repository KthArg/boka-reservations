import { formatMoneyCents } from '@/lib/format/money';
import { BookingStatus } from '@shared/constants/enums';
import { CancellationReason, type CancellationReasonValue } from '@shared/constants/cancellations';
import { computeRefund } from '@shared/constants/policies';
import type { AdminBookingDetail } from '@/lib/booking/admin-types';
import { CheckInButton } from '../CheckInButton';
import { CancelBookingButton } from '../CancelBookingButton';
import { CancelPaidBookingDialog, type ReasonPreview } from '../CancelPaidBookingDialog';
import { ManualChargeButton } from '../ManualChargeButton';
import styles from '../bookings.module.css';

type Props = { booking: AdminBookingDetail; locale: string; isAdmin: boolean };

/** Reembolso de un motivo, ya formateado para el diálogo (specs 0032 y 0034). */
function reasonPreview(
  booking: AdminBookingDetail,
  reason: CancellationReasonValue,
  locale: string,
  now: Date,
): ReasonPreview {
  const refund = computeRefund({
    startsAt: new Date(booking.startsAt),
    totalAmountCents: booking.totalAmountCents,
    reason,
    now,
  });
  return {
    amountCents: refund.amountCents,
    amount: refund.eligible ? formatMoneyCents(refund.amountCents, booking.currency, locale) : null,
  };
}

/**
 * Acciones del detalle de reserva según su estado: check-in y cancelación con motivo para una
 * confirmada (spec 0032); cobro manual y cancelación sin costo para una sin cobrar (spec 0029);
 * cancelación soltando la retención para una autorizada (spec 0033 §5.6).
 */
export function BookingDetailActions({ booking, locale, isAdmin }: Props) {
  // Una reserva en revisión (spec 0035) se decide en su propia sección, no con la cancelación.
  const isConfirmed = booking.status === BookingStatus.Confirmed && !booking.underReview;
  const isUnpaid = booking.status === BookingStatus.PendingMinimum;
  const now = new Date();
  const departureStarted = new Date(booking.startsAt).getTime() <= now.getTime();

  return (
    <div className={styles.headerActions}>
      {isConfirmed ? (
        <>
          <CheckInButton bookingId={booking.id} checkedIn={booking.checkedInAt !== null} />
          <CancelPaidBookingDialog
            bookingId={booking.id}
            customer={reasonPreview(booking, CancellationReason.CustomerRequest, locale, now)}
            operator={reasonPreview(booking, CancellationReason.OperatorDecision, locale, now)}
            operatorAllowed={isAdmin || !departureStarted}
          />
        </>
      ) : null}
      {isUnpaid && booking.hasSavedCard ? (
        <ManualChargeButton
          bookingId={booking.id}
          retry={booking.chargeAttempts > 0}
          amount={formatMoneyCents(booking.totalAmountCents, booking.currency, locale)}
        />
      ) : null}
      {isUnpaid || booking.authorizationHeld ? (
        <CancelBookingButton bookingId={booking.id} unpaid held={booking.authorizationHeld} />
      ) : null}
    </div>
  );
}
