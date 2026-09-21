'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { cancelByStaff } from '@/lib/booking/cancel-action';
import { CancellationError } from '@shared/constants/cancellations';
import styles from './bookings.module.css';

type Props = {
  bookingId: string;
  refundAmount: string | null;
  /** Reserva sin cobrar del flujo diferido (spec 0029): no hay reembolso posible. */
  unpaid?: boolean;
};

export function CancelBookingButton({ bookingId, refundAmount, unpaid = false }: Props) {
  const t = useTranslations('bookings');
  const [pending, startTransition] = useTransition();

  function confirmText(): string {
    if (unpaid) return t('cancel-confirm-no-charge');
    if (!refundAmount) return t('cancel-confirm-no-refund');
    return t('cancel-confirm-refund', { amount: refundAmount });
  }

  function onClick() {
    if (!window.confirm(confirmText())) return;
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
