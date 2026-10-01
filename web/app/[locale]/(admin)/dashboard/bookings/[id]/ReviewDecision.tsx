'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useDialogs } from '@/components/dialogs/DialogProvider';
import { decideReviewAction } from '@/lib/operations/booking-actions';
import { ReviewDecision as Decision, type ReviewDecisionValue } from '@shared/constants/operations';
import styles from '../bookings.module.css';

/**
 * Las dos decisiones con plata sobre una reserva en revisión (spec 0035): reembolso del 100 % o
 * cierre sin reembolso. La tercera, otra fecha, es el formulario de cambio de fecha.
 */
export function ReviewDecision({ bookingId }: { bookingId: string }) {
  const t = useTranslations('operations');
  const { confirm, alert } = useDialogs();
  const [pending, startTransition] = useTransition();

  async function decide(decision: ReviewDecisionValue) {
    const ask = decision === Decision.Refund ? 'review-refund-ask' : 'review-no-refund-ask';
    const tone = decision === Decision.Refund ? 'default' : 'danger';
    if (!(await confirm(t(ask), { tone }))) return;
    startTransition(async () => {
      const result = await decideReviewAction(bookingId, decision);
      if (!result.ok) alert(t(`error-${result.error}`));
    });
  }

  return (
    <div className={styles.operationActions}>
      <button
        type="button"
        className={styles.primaryBtn}
        disabled={pending}
        onClick={() => decide(Decision.Refund)}
      >
        {t('review-refund')}
      </button>
      <button
        type="button"
        className={styles.secondaryBtn}
        disabled={pending}
        onClick={() => decide(Decision.NoRefund)}
      >
        {t('review-no-refund')}
      </button>
    </div>
  );
}
