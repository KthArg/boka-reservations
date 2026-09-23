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
  /**
   * Lo que mostró la página. El servidor no cancela si cambió al confirmar (spec 0032), así el
   * mensaje de resultado, que depende de `unpaid`, siempre corresponde a lo que se aplicó.
   */
  expected: { status: string; refundAmountCents: number };
};

type Outcome =
  | { kind: 'done'; refund: RefundEligibility }
  | { kind: 'error'; error: CancellationError };

const ERROR_KEYS: Partial<Record<CancellationError, string>> = {
  [CancellationError.ChargeInFlight]: 'error-charge-in-flight',
  [CancellationError.StateChanged]: 'error-state-changed',
};

export function CancelConfirm({ token, currency, unpaid, expected }: Props) {
  const t = useTranslations('cancellation');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function doneMessage(refund: RefundEligibility): string {
    if (unpaid) return t('cancelled-no-charge');
    if (!refund.eligible) return t('cancelled-no-refund');
    const refunded = t('cancelled-refund', {
      amount: formatMoneyCents(refund.amountCents, currency, locale),
    });
    // Spec 0032: el monto aplicado se recalcula al confirmar; si hubo descuento, se explica.
    if (refund.feeCents === 0) return refunded;
    const fee = t('refund-fee', { fee: formatMoneyCents(refund.feeCents, currency, locale) });
    return `${refunded} ${fee}`;
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
      const result = await cancelByToken(token, expected);
      setOutcome(
        result.ok
          ? { kind: 'done', refund: result.refund }
          : { kind: 'error', error: result.error },
      );
    });
  }

  return (
    <div>
      {outcome?.kind === 'error' ? (
        <p className={styles.error}>{t(ERROR_KEYS[outcome.error] ?? 'error-generic')}</p>
      ) : null}
      <button type="button" className={styles.dangerButton} onClick={onConfirm} disabled={pending}>
        {t('confirm')}
      </button>
    </div>
  );
}
