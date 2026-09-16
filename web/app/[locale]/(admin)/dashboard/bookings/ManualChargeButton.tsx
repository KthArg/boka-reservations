'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { chargeBookingAction } from '@/lib/booking/manual-charge-action';
import styles from './bookings.module.css';

type Props = {
  bookingId: string;
  /** Hubo al menos un intento rechazado: la acción se presenta como "Volver a cobrar". */
  retry: boolean;
  amount: string;
};

/** Cobro manual de una reserva sin cobrar (spec 0029 §5.11). */
export function ManualChargeButton({ bookingId, retry, amount }: Props) {
  const t = useTranslations('bookings');
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm(t('charge-confirm', { amount }))) return;
    startTransition(async () => {
      const { outcome } = await chargeBookingAction(bookingId);
      window.alert(t(`charge-result-${outcome}`));
    });
  }

  return (
    <button type="button" className={styles.chargeBtn} onClick={onClick} disabled={pending}>
      {retry ? t('charge-retry') : t('charge-now')}
    </button>
  );
}
