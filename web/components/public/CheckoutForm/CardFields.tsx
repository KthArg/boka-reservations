'use client';

import { useTranslations } from 'next-intl';
import { CARD_FIELD_MAX_LENGTH, type CardFormValues } from '@/lib/payments/card-input';
import styles from './CheckoutForm.module.css';
import deferredStyles from './DeferredCheckout.module.css';

type Props = {
  value: CardFormValues;
  onChange: (value: CardFormValues) => void;
  disabled: boolean;
};

type CardKey = keyof CardFormValues;

const CARD_NUMBER_GROUP = 4;
const MAX_CARD_DIGITS = 19;

/** El número en grupos de 4 mientras se escribe; `toCardInput` saca los espacios al validar. */
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, MAX_CARD_DIGITS);
  return digits.replace(new RegExp(`(\\d{${CARD_NUMBER_GROUP}})(?=\\d)`, 'g'), '$1 ');
}

function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Campos de la tarjeta, controlados (spec 0029 §5.2). Solo presentan. Sin atributo `name` a
 * propósito: estos valores no pueden viajar en un submit de formulario.
 */
export function CardFields({ value, onChange, disabled }: Props) {
  const t = useTranslations('checkout');

  const input = (
    key: CardKey,
    options: {
      autoComplete: string;
      numeric: boolean;
      placeholder: string;
      ariaLabel?: string;
      format?: (raw: string) => string;
      className?: string;
    },
  ) => (
    <input
      id={`card-${key}`}
      type="text"
      autoComplete={options.autoComplete}
      inputMode={options.numeric ? 'numeric' : 'text'}
      maxLength={CARD_FIELD_MAX_LENGTH[key]}
      placeholder={options.placeholder}
      aria-label={options.ariaLabel}
      value={value[key]}
      onChange={(e) => {
        const raw = e.target.value;
        onChange({ ...value, [key]: options.format ? options.format(raw) : raw });
      }}
      disabled={disabled}
      required
      className={`${styles.input} ${options.className ?? ''}`}
    />
  );

  return (
    <div className={deferredStyles.cardPanel}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="card-number">
          {t('card-number')}
        </label>
        {input('number', {
          autoComplete: 'cc-number',
          numeric: true,
          placeholder: '1234 1234 1234 1234',
          format: formatCardNumber,
          className: deferredStyles.digits,
        })}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="card-holderName">
          {t('card-holder')}
        </label>
        {input('holderName', {
          autoComplete: 'cc-name',
          numeric: false,
          placeholder: t('card-holder-placeholder'),
        })}
      </div>

      <div className={deferredStyles.cardRow}>
        {/* Grupo con etiqueta en vez de <fieldset>: el <legend> no se alinea con el label del CVV. */}
        <div className={styles.field} role="group" aria-labelledby="card-expiry">
          <span id="card-expiry" className={styles.label}>
            {t('card-expiry')}
          </span>
          <div className={deferredStyles.expiryInputs}>
            {input('expMonth', {
              autoComplete: 'cc-exp-month',
              numeric: true,
              placeholder: t('card-exp-month-placeholder'),
              ariaLabel: t('card-exp-month'),
              format: onlyDigits,
              className: deferredStyles.digits,
            })}
            <span className={deferredStyles.expirySeparator} aria-hidden="true">
              /
            </span>
            {input('expYear', {
              autoComplete: 'cc-exp-year',
              numeric: true,
              placeholder: t('card-exp-year-placeholder'),
              ariaLabel: t('card-exp-year'),
              format: onlyDigits,
              className: deferredStyles.digits,
            })}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="card-cvv">
            {t('card-cvv')}
          </label>
          {input('cvv', {
            autoComplete: 'cc-csc',
            numeric: true,
            placeholder: '123',
            format: onlyDigits,
            className: deferredStyles.digits,
          })}
          <span className={deferredStyles.hint}>{t('card-cvv-hint')}</span>
        </div>
      </div>

      <p className={deferredStyles.secureNote}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"
          />
        </svg>
        {t('card-secure-note')}
      </p>
    </div>
  );
}
