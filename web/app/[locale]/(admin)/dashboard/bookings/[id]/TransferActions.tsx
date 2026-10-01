'use client';

import { useActionState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useDialogs } from '@/components/dialogs/DialogProvider';
import { requestTransferAction, settleTransferAction } from '@/lib/operations/transfer-actions';
import {
  TRANSFER_REFERENCE_MAX_LENGTH,
  TransferChannel,
  TransferCurrency,
} from '@shared/constants/refunds';
import styles from '../bookings.module.css';

type Props = { refundId: string; bookingId: string };

type SettleProps = Props & { refundAmount: string };

/** Pedirle al turista los datos de una cuenta (spec 0035): la tarjeta no aceptó el reembolso. */
export function RequestTransferButton({ refundId, bookingId }: Props) {
  const t = useTranslations('operations');
  const { confirm, alert } = useDialogs();
  const [pending, startTransition] = useTransition();

  async function request() {
    if (!(await confirm(t('transfer-request-ask')))) return;
    startTransition(async () => {
      const result = await requestTransferAction(refundId, bookingId);
      if (!result.ok) alert(t(`error-${result.error}`));
    });
  }

  return (
    <button type="button" className={styles.retryBtn} onClick={request} disabled={pending}>
      {t('transfer-request')}
    </button>
  );
}

/** Registrar la transferencia hecha desde el banco del operador: canal, comprobante y fecha. */
export function SettleTransferForm({ refundId, bookingId, refundAmount }: SettleProps) {
  const t = useTranslations('operations');
  const [state, action, pending] = useActionState(settleTransferAction, null);

  return (
    <form action={action} className={styles.operationForm}>
      <p className={styles.empty}>{t('transfer-awaiting')}</p>
      <input type="hidden" name="refundId" value={refundId} />
      <input type="hidden" name="bookingId" value={bookingId} />
      <label className={styles.operationField}>
        <span>{t('transfer-channel')}</span>
        <select name="channel" required defaultValue="">
          <option value="" disabled />
          {Object.values(TransferChannel).map((channel) => (
            <option key={channel} value={channel}>
              {t(`channel-${channel}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.operationField}>
        <span>{t('transfer-reference')}</span>
        <input name="reference" required maxLength={TRANSFER_REFERENCE_MAX_LENGTH} />
      </label>
      <label className={styles.operationField}>
        <span>{t('transfer-currency')}</span>
        <select name="currency" required defaultValue="">
          <option value="" disabled />
          {Object.values(TransferCurrency).map((currency) => (
            <option key={currency} value={currency}>
              {t(`currency-${currency}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.operationField}>
        <span>{t('transfer-amount')}</span>
        <input name="amount" type="number" min="0.01" step="0.01" required />
      </label>
      <p className={styles.empty}>{t('transfer-amount-hint', { amount: refundAmount })}</p>
      <label className={styles.operationField}>
        <span>{t('transfer-paid-on')}</span>
        <input type="date" name="paidOn" required />
      </label>
      {state && !state.ok ? (
        <p className={styles.formError} role="alert">
          {t(`error-${state.error}`)}
        </p>
      ) : null}
      <button type="submit" className={styles.primaryBtn} disabled={pending}>
        {t('transfer-submit')}
      </button>
    </form>
  );
}
