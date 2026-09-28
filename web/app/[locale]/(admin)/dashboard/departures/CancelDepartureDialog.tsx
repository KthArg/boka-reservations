'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { cancelDepartureAction } from '@/lib/operations/departure-actions';
import {
  DepartureCancellationReason,
  REVIEW_REASONS,
  type DepartureCancellationReasonValue,
} from '@shared/constants/operations';
import buttons from './departures.module.css';
import styles from './CancelDepartureDialog.module.css';

type Props = {
  instanceId: string;
  /** Faltan más de 24 horas y la salida no está resuelta: se puede cancelar por mínimo. */
  canCancelForMinimum: boolean;
};

const REASONS: readonly DepartureCancellationReasonValue[] = [
  DepartureCancellationReason.Minimum,
  DepartureCancellationReason.Weather,
  DepartureCancellationReason.Safety,
  DepartureCancellationReason.Other,
];

/**
 * Cancelar una salida entera con un motivo (spec 0035). El motivo decide la plata: por mínimo u
 * otra causa, el 100 % al instante; por clima o seguridad, cada reserva queda en revisión. Cada
 * opción lo dice antes de confirmar.
 */
export function CancelDepartureDialog({ instanceId, canCancelForMinimum }: Props) {
  const t = useTranslations('operations');
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<DepartureCancellationReasonValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function detail(value: DepartureCancellationReasonValue): string {
    if (value === DepartureCancellationReason.Minimum && !canCancelForMinimum) {
      return t('reason-minimum-too-late');
    }
    return t(REVIEW_REASONS.includes(value) ? 'reason-hint-review' : 'reason-hint-refund');
  }

  function confirm() {
    if (!reason) return;
    startTransition(async () => {
      const result = await cancelDepartureAction(instanceId, reason);
      if (result.ok) {
        dialog.current?.close();
        return;
      }
      setError(t(`error-${result.error}`));
    });
  }

  return (
    <>
      <button
        type="button"
        className={buttons.cancelButton}
        onClick={() => dialog.current?.showModal()}
      >
        {t('cancel-departure')}
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={titleId}
        onClose={() => {
          setReason(null);
          setError(null);
        }}
      >
        <h2 id={titleId} className={styles.title}>
          {t('cancel-title')}
        </h2>
        <fieldset className={styles.options} disabled={pending}>
          <legend className={styles.legend}>{t('cancel-reason-label')}</legend>
          {REASONS.map((value) => (
            <label key={value} className={styles.option}>
              <input
                type="radio"
                name="departure-cancel-reason"
                value={value}
                checked={reason === value}
                disabled={value === DepartureCancellationReason.Minimum && !canCancelForMinimum}
                onChange={() => setReason(value)}
              />
              <span>
                <span className={styles.optionLabel}>{t(`reason-${value}`)}</span>
                <span className={styles.optionDetail}>{detail(value)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className={styles.backBtn} onClick={() => dialog.current?.close()}>
            {t('back')}
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            onClick={confirm}
            disabled={!reason || pending}
          >
            {t('cancel-confirm')}
          </button>
        </div>
      </dialog>
    </>
  );
}
