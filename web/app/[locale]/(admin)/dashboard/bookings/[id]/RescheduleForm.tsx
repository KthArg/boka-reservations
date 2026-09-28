'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { rescheduleBookingAction } from '@/lib/operations/booking-actions';
import styles from '../bookings.module.css';

export type RescheduleOption = { id: string; label: string };

type Props = { bookingId: string; options: RescheduleOption[] };

/**
 * Pasar la reserva a otra salida del mismo tour (spec 0035): sin cobro ni reembolso. El cupo lo
 * verifica la base al mover, contando también los apartados en curso.
 */
export function RescheduleForm({ bookingId, options }: Props) {
  const t = useTranslations('operations');
  const [target, setTarget] = useState('');
  const [pending, startTransition] = useTransition();

  if (options.length === 0) return <p className={styles.empty}>{t('reschedule-empty')}</p>;

  function submit() {
    if (!target || !window.confirm(t('reschedule-ask'))) return;
    startTransition(async () => {
      const result = await rescheduleBookingAction(bookingId, target);
      if (!result.ok) window.alert(t(`error-${result.error}`));
    });
  }

  return (
    <div className={styles.operationActions}>
      <label className={styles.operationField}>
        <span>{t('reschedule-label')}</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={pending}>
          <option value="" />
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={styles.primaryBtn}
        disabled={!target || pending}
        onClick={submit}
      >
        {t('reschedule-submit')}
      </button>
    </div>
  );
}
