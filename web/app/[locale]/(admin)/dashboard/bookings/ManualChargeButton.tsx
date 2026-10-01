'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useDialogs } from '@/components/dialogs/DialogProvider';
import { chargeBookingAction } from '@/lib/booking/manual-charge-action';
import type { AlertTone } from '@/components/dialogs/DialogProvider';
import {
  ManualChargeOutcome,
  type ManualChargeOutcomeValue,
} from '@/lib/booking/manual-charge-outcomes';
import styles from './bookings.module.css';

const PENDING_OUTCOMES: ReadonlySet<ManualChargeOutcomeValue> = new Set([
  ManualChargeOutcome.RequiresAction,
  ManualChargeOutcome.Processing,
  ManualChargeOutcome.InProgress,
]);

/** Tono del aviso del resultado: cobrado, en curso o fallido. */
function chargeTone(outcome: ManualChargeOutcomeValue): AlertTone {
  if (outcome === ManualChargeOutcome.Confirmed) return 'success';
  return PENDING_OUTCOMES.has(outcome) ? 'info' : 'error';
}

type Props = {
  bookingId: string;
  /** Hubo al menos un intento rechazado: la acción se presenta como "Volver a cobrar". */
  retry: boolean;
  amount: string;
};

/** Cobro manual de una reserva sin cobrar (spec 0029 §5.11). */
export function ManualChargeButton({ bookingId, retry, amount }: Props) {
  const t = useTranslations('bookings');
  const { confirm, alert } = useDialogs();
  const [pending, startTransition] = useTransition();

  async function onClick() {
    if (!(await confirm(t('charge-confirm', { amount })))) return;
    startTransition(async () => {
      const { outcome } = await chargeBookingAction(bookingId);
      alert(t(`charge-result-${outcome}`), { tone: chargeTone(outcome) });
    });
  }

  return (
    <button type="button" className={styles.chargeBtn} onClick={onClick} disabled={pending}>
      {retry ? t('charge-retry') : t('charge-now')}
    </button>
  );
}
