'use client';

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { cancelByToken } from '@/lib/booking/cancel-action';
import { formatMoneyCents } from '@/lib/format/money';
import type { RefundEligibility } from '@shared/constants/policies';
import styles from './booking.module.css';

type Props = { token: string; currency: string };

type Outcome = { kind: 'done'; refund: RefundEligibility } | { kind: 'error' };

export function CancelConfirm({ token, currency }: Props) {
  const t = useTranslations('cancellation');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (outcome?.kind === 'done') {
    const message = outcome.refund.eligible
      ? t('cancelled-refund', {
          amount: formatMoneyCents(outcome.refund.amountCents, currency, locale),
        })
      : t('cancelled-no-refund');
    return (
      <div className={styles.result}>
        <h2 className={styles.resultTitle}>{t('cancelled-title')}</h2>
        <p className={styles.muted}>{message}</p>
      </div>
    );
  }

  function onConfirm() {
    startTransition(async () => {
      const result = await cancelByToken(token);
      setOutcome(result.ok ? { kind: 'done', refund: result.refund } : { kind: 'error' });
    });
  }

  return (
    <div>
      {outcome?.kind === 'error' ? <p className={styles.error}>{t('error-generic')}</p> : null}
      <button type="button" className={styles.dangerButton} onClick={onConfirm} disabled={pending}>
        {t('confirm')}
      </button>
    </div>
  );
}
