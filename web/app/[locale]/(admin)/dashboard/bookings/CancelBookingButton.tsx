'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { cancelByStaff } from '@/lib/booking/cancel-action';
import styles from './bookings.module.css';

type Props = { bookingId: string; refundAmount: string | null };

export function CancelBookingButton({ bookingId, refundAmount }: Props) {
  const t = useTranslations('bookings');
  const [pending, startTransition] = useTransition();

  const confirmText = refundAmount
    ? t('cancel-confirm-refund', { amount: refundAmount })
    : t('cancel-confirm-no-refund');

  function onClick() {
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await cancelByStaff(bookingId);
      if (!result.ok) window.alert(t('cancel-error'));
    });
  }

  return (
    <button type="button" className={styles.cancelBtn} onClick={onClick} disabled={pending}>
      {t('detail-cancel')}
    </button>
  );
}
