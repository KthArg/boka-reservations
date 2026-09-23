'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { cancelByStaff } from '@/lib/booking/cancel-action';
import { CancellationError } from '@shared/constants/cancellations';
import styles from './bookings.module.css';

type Props = {
  bookingId: string;
  /** Reserva sin cobrar del flujo diferido (spec 0029): no hay reembolso posible. */
  unpaid: true;
};

/**
 * Cancelación sin costo de una reserva sin cobrar. Una reserva cobrada usa
 * `CancelPaidBookingDialog`, que pide el motivo (spec 0032).
 */
export function CancelBookingButton({ bookingId }: Props) {
  const t = useTranslations('bookings');
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm(t('cancel-confirm-no-charge'))) return;
    startTransition(async () => {
      const result = await cancelByStaff(bookingId);
      if (result.ok) return;
      window.alert(
        result.error === CancellationError.ChargeInFlight
          ? t('cancel-error-in-flight')
          : t('cancel-error'),
      );
    });
  }

  return (
    <button type="button" className={styles.cancelBtn} onClick={onClick} disabled={pending}>
      {t('detail-cancel')}
    </button>
  );
}
