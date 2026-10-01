'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useDialogs } from '@/components/dialogs/DialogProvider';
import { toggleCheckIn } from '@/lib/booking/checkin-action';
import { CheckInAction } from '@shared/constants/bookings';
import { Icon } from '@/components/admin/icons';
import styles from './bookings.module.css';

type Props = {
  bookingId: string;
  checkedIn: boolean;
};

export function CheckInButton({ bookingId, checkedIn }: Props) {
  const t = useTranslations('bookings');
  const { confirm, alert } = useDialogs();
  const [pending, startTransition] = useTransition();

  const action = checkedIn ? CheckInAction.Revert : CheckInAction.CheckIn;
  const label = checkedIn ? t('checkin-revert') : t('checkin-mark');
  const confirmText = checkedIn ? t('checkin-revert-confirm') : t('checkin-confirm');

  async function onClick() {
    if (!(await confirm(confirmText))) return;
    startTransition(async () => {
      const result = await toggleCheckIn(bookingId, action);
      if (!result.ok) alert(t('checkin-error'));
    });
  }

  return (
    <button type="button" className={styles.checkinBtn} onClick={onClick} disabled={pending}>
      <Icon name={checkedIn ? 'retry' : 'checkin'} size={14} />
      {label}
    </button>
  );
}
