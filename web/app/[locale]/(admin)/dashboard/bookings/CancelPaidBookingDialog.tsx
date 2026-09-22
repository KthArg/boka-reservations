'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { cancelByStaff } from '@/lib/booking/cancel-action';
import {
  CancellationError,
  CancellationReason,
  type CancellationReasonValue,
} from '@shared/constants/cancellations';
import buttons from './bookings.module.css';
import styles from './CancelPaidBookingDialog.module.css';

/** Reembolso de un motivo: centavos (para el servidor) y textos ya formateados (`null` = sin). */
export type ReasonPreview = { amountCents: number; amount: string | null; fee: string | null };

type Props = {
  bookingId: string;
  /** `null`: la vista previa no se pudo calcular y la opción queda deshabilitada. */
  customer: ReasonPreview | null;
  operator: ReasonPreview | null;
  /** Staff sobre una salida que ya empezó: solo un admin reembolsa el total (spec 0032). */
  operatorAllowed: boolean;
};

const ERROR_KEYS: Partial<Record<CancellationError, string>> = {
  [CancellationError.ChargeInFlight]: 'cancel-error-in-flight',
  [CancellationError.OperatorRefundAdminOnly]: 'cancel-option-admin-only',
  [CancellationError.NotCancellable]: 'cancel-error-not-cancellable',
  [CancellationError.ReasonRequired]: 'cancel-error-reason-required',
  [CancellationError.StateChanged]: 'cancel-error-state-changed',
};

/**
 * Cancelación de una reserva cobrada desde el panel (spec 0032): el staff elige si cancela a
 * pedido del cliente (se descuenta la comisión si corresponde) o por decisión del operador
 * (reembolso total). Sin opción preseleccionada; confirmar queda deshabilitado hasta elegir. El
 * servidor rechaza si el monto mostrado ya no es el que corresponde.
 */
export function CancelPaidBookingDialog(props: Props) {
  const t = useTranslations('bookings');
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<CancellationReasonValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = [
    { value: CancellationReason.CustomerRequest, preview: props.customer, allowed: true },
    {
      value: CancellationReason.OperatorDecision,
      preview: props.operator,
      allowed: props.operatorAllowed,
    },
  ];

  function detail(preview: ReasonPreview | null, allowed: boolean): string {
    if (!allowed) return t('cancel-option-admin-only');
    if (!preview) return t('cancel-error');
    if (!preview.amount) return t('cancel-option-no-refund');
    if (!preview.fee) return t('cancel-option-refund', { amount: preview.amount });
    return t('cancel-option-refund-fee', { amount: preview.amount, fee: preview.fee });
  }

  function confirm() {
    const chosen = options.find((option) => option.value === reason);
    if (!chosen?.preview) return;
    const expectedCents = chosen.preview.amountCents;
    startTransition(async () => {
      const result = await cancelByStaff(props.bookingId, chosen.value, expectedCents);
      if (result.ok) {
        dialog.current?.close();
        return;
      }
      setError(t(ERROR_KEYS[result.error] ?? 'cancel-error'));
    });
  }

  function reset() {
    setReason(null);
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        className={buttons.cancelBtn}
        onClick={() => dialog.current?.showModal()}
      >
        {t('detail-cancel')}
      </button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onClose={reset}>
        <h2 id={titleId} className={styles.title}>
          {t('cancel-dialog-title')}
        </h2>
        <fieldset className={styles.options} disabled={pending}>
          <legend className={styles.legend}>{t('cancel-dialog-reason')}</legend>
          {options.map((option) => (
            <label key={option.value} className={styles.option}>
              <input
                type="radio"
                name="cancel-reason"
                value={option.value}
                checked={reason === option.value}
                disabled={!option.allowed || !option.preview}
                onChange={() => setReason(option.value)}
              />
              <span>
                <span className={styles.optionLabel}>{t(`cancel-reason-${option.value}`)}</span>
                <span className={styles.optionDetail}>
                  {detail(option.preview, option.allowed)}
                </span>
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
          <button
            type="button"
            className={buttons.secondaryBtn}
            onClick={() => dialog.current?.close()}
          >
            {t('cancel-dialog-back')}
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            onClick={confirm}
            disabled={!reason || pending}
          >
            {t('cancel-dialog-confirm')}
          </button>
        </div>
      </dialog>
    </>
  );
}
