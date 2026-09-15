'use client';

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { cancelByToken } from '@/lib/booking/cancel-action';
import { formatMoneyCents } from '@/lib/format/money';
import { CancellationError } from '@shared/constants/cancellations';
import type { RefundEligibility } from '@shared/constants/policies';
import styles from './booking.module.css';

type Props = {
  token: string;
  currency: string;
  /** Reserva sin cobrar del flujo diferido (spec 0029): se cancela sin costo. */
  unpaid: boolean;
};

type Outcome =
  | { kind: 'done'; refund: RefundEligibility }
  | { kind: 'error'; chargeInFlight: boolean };

export function CancelConfirm({ token, currency, unpaid }: Props) {
  const t = useTranslations('cancellation');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function doneMessage(refund: RefundEligibility): string {
    if (unpaid) return t('cancelled-no-charge');
    if (!refund.eligible) return t('cancelled-no-refund');
    return t('cancelled-refund', {
      amount: formatMoneyCents(refund.amountCents, currency, locale),
    });
  }

  if (outcome?.kind === 'done') {
    return (
      <div className={styles.result}>
        <h2 className={styles.resultTitle}>{t('cancelled-title')}</h2>
        <p className={styles.muted}>{doneMessage(outcome.refund)}</p>
      </div>
    );
  }

  function onConfirm() {
    startTransition(async () => {
      const result = await cancelByToken(token);
      setOutcome(
        result.ok
          ? { kind: 'done', refund: result.refund }
          : { kind: 'error', chargeInFlight: result.error === CancellationError.ChargeInFlight },
      );
    });
  }

  return (
    <div>
      {outcome?.kind === 'error' ? (
        <p className={styles.error}>
          {outcome.chargeInFlight ? t('error-charge-in-flight') : t('error-generic')}
        </p>
      ) : null}
      <button type="button" className={styles.dangerButton} onClick={onConfirm} disabled={pending}>
        {t('confirm')}
      </button>
    </div>
  );
}
