import { getTranslations } from 'next-intl/server';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import type { AdminBookingDetail } from '@/lib/booking/admin-types';
import { listRescheduleTargets } from '@/lib/operations/repository';
import { BookingStatus } from '@shared/constants/enums';
import { DepartureCancellationReason } from '@shared/constants/operations';
import { ReviewDecision } from './ReviewDecision';
import { RescheduleForm } from './RescheduleForm';
import styles from '../bookings.module.css';

/**
 * Operación sobre una reserva cobrada (spec 0035): la decisión de una reserva en revisión y el
 * cambio de fecha. Solo para reservas confirmadas.
 */
export async function BookingOperations({ booking }: { booking: AdminBookingDetail }) {
  if (booking.status !== BookingStatus.Confirmed || !booking.instanceId) return null;
  const t = await getTranslations('operations');
  const targets = await listRescheduleTargets(booking.tourId, booking.instanceId);
  const options = targets.map((target) => {
    const { date, time } = formatOperatorDateTime(target.startsAt);
    return {
      id: target.id,
      label: t('reschedule-option', { date: `${date} ${time}`, seats: target.seatsLeft }),
    };
  });

  return (
    <>
      {booking.underReview ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('review-title')}</h2>
          <p className={styles.reviewNotice}>
            {t('review-intro', {
              reason: t(
                `review-reason-${booking.cancellationReason ?? DepartureCancellationReason.Other}`,
              ),
            })}
          </p>
          <ReviewDecision bookingId={booking.id} />
          <p className={styles.empty}>{t('review-reschedule-hint')}</p>
        </section>
      ) : null}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('reschedule-title')}</h2>
        <RescheduleForm bookingId={booking.id} options={options} />
      </section>
    </>
  );
}
