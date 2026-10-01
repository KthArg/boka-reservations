'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useDialogs } from '@/components/dialogs/DialogProvider';
import { retryRefund } from '@/lib/refunds/retry-action';
import { RefundRetryError } from '@shared/constants/cancellations';
import styles from './bookings.module.css';

export function RetryRefundButton({ refundId }: { refundId: string }) {
  const t = useTranslations('bookings');
  const { confirm, alert } = useDialogs();
  const [pending, startTransition] = useTransition();

  async function onClick() {
    if (!(await confirm(t('refund-retry-confirm')))) return;
    startTransition(async () => {
      const result = await retryRefund(refundId);
      if (!result.ok) {
        const key =
          result.error === RefundRetryError.RequiresManualCheck
            ? 'refund-retry-manual-check'
            : 'refund-retry-error';
        alert(t(key));
      }
    });
  }

  return (
    <button type="button" className={styles.retryBtn} onClick={onClick} disabled={pending}>
      {t('refund-retry')}
    </button>
  );
}
