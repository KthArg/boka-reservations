import { formatMoneyCents } from '@/lib/format/money';
import { captureAlert } from '@/lib/booking/sentry-alert';
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

/**
 * Reembolso de un motivo, ya formateado para el diálogo (spec 0032). `null` si la comisión no se
 * pudo calcular: se reporta a Sentry y esa opción queda deshabilitada; la otra sigue disponible.
 */
function reasonPreview(
  booking: AdminBookingDetail,
  reason: CancellationReasonValue,
  locale: string,
  now: Date,
): ReasonPreview | null {
  try {
    const refund = computeRefund({
      startsAt: new Date(booking.startsAt),
      totalAmountCents: booking.totalAmountCents,
      currency: booking.currency,
      termsVersion: booking.termsVersion,
      reason,
      now,
    });
    const money = (cents: number) => formatMoneyCents(cents, booking.currency, locale);
    return {
      amountCents: refund.amountCents,
      amount: refund.eligible ? money(refund.amountCents) : null,
      fee: refund.eligible && refund.feeCents > 0 ? money(refund.feeCents) : null,
    };
  } catch (err) {
    captureAlert('[cancel] no se pudo calcular la vista previa', 'refund-preview-failed', {
      bookingId: booking.id,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

/**
 * Acciones del detalle de reserva según su estado: check-in y cancelación con motivo para una
 * confirmada (spec 0032); cobro manual y cancelación sin costo para una sin cobrar (spec 0029).
 */
export function BookingDetailActions({ booking, locale, isAdmin }: Props) {
  const isConfirmed = booking.status === BookingStatus.Confirmed;
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
      {isUnpaid ? <CancelBookingButton bookingId={booking.id} unpaid /> : null}
    </div>
  );
}
