'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { retryRefund } from '@/lib/refunds/retry-action';
import styles from './bookings.module.css';

export function RetryRefundButton({ refundId }: { refundId: string }) {
  const t = useTranslations('bookings');
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm(t('refund-retry-confirm'))) return;
    startTransition(async () => {
      const result = await retryRefund(refundId);
      if (!result.ok) window.alert(t('refund-retry-error'));
    });
  }

  return (
    <button type="button" className={styles.retryBtn} onClick={onClick} disabled={pending}>
      {t('refund-retry')}
    </button>
  );
}
