import { getTranslations } from 'next-intl/server';
import type { AdminBookingDetail } from '@/lib/booking/admin-types';
import { formatMoneyCents } from '@/lib/format/money';
import { RefundMethod, RefundStatus } from '@shared/constants/refunds';
import { RetryRefundButton } from '../RetryRefundButton';
import { RequestTransferButton, SettleTransferForm } from './TransferActions';
import styles from '../bookings.module.css';

type Props = { booking: AdminBookingDetail; locale: string };

/**
 * Estado del reembolso con sus acciones: reintentar en OnvoPay, pedir los datos para devolver por
 * transferencia (spec 0035) y registrar la transferencia hecha.
 */
export async function RefundSection({ booking, locale }: Props) {
  const refund = booking.refund;
  if (!refund) return null;
  const [t, tOps] = await Promise.all([getTranslations('bookings'), getTranslations('operations')]);
  const transferred =
    refund.method === RefundMethod.Transfer &&
    refund.status === RefundStatus.Succeeded &&
    refund.transferChannel;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t('detail-refund')}</h2>
      <div className={styles.refundRow}>
        <span>{t(`refund-status-${refund.status}`)}</span>
        {refund.status === RefundStatus.Failed ? <RetryRefundButton refundId={refund.id} /> : null}
        {refund.transferAllowed ? (
          <RequestTransferButton refundId={refund.id} bookingId={booking.id} />
        ) : null}
      </div>
      {refund.failureReason ? <p className={styles.empty}>{refund.failureReason}</p> : null}
      {refund.status === RefundStatus.AwaitingTransfer ? (
        <SettleTransferForm
          refundId={refund.id}
          bookingId={booking.id}
          refundAmount={formatMoneyCents(refund.amountCents, refund.currency, locale)}
        />
      ) : null}
      {transferred ? (
        <p className={styles.empty}>
          {tOps('transfer-done', {
            channel: tOps(`channel-${refund.transferChannel}`),
            amount: formatMoneyCents(
              refund.transferAmountCents ?? refund.amountCents,
              refund.transferCurrency ?? refund.currency,
              locale,
            ),
          })}
        </p>
      ) : null}
    </section>
  );
}
