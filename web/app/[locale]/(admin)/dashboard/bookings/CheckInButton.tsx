'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toggleCheckIn } from '@/lib/booking/checkin-action';
import { CheckInAction } from '@shared/constants/bookings';
import styles from './bookings.module.css';

type Props = {
  bookingId: string;
  checkedIn: boolean;
};

export function CheckInButton({ bookingId, checkedIn }: Props) {
  const t = useTranslations('bookings');
  const [pending, startTransition] = useTransition();

  const action = checkedIn ? CheckInAction.Revert : CheckInAction.CheckIn;
  const label = checkedIn ? t('checkin-revert') : t('checkin-mark');
  const confirmText = checkedIn ? t('checkin-revert-confirm') : t('checkin-confirm');

  function onClick() {
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await toggleCheckIn(bookingId, action);
      if (!result.ok) window.alert(t('checkin-error'));
    });
  }

  return (
    <button type="button" className={styles.checkinBtn} onClick={onClick} disabled={pending}>
      {label}
    </button>
  );
}
