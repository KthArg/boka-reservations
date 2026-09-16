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

type CardField = {
  key: keyof CardFormValues;
  autoComplete: string;
  inputMode: 'numeric' | 'text';
};

// Sin atributo `name` a propósito: estos valores no pueden viajar en un submit de formulario.
const FIELDS: readonly CardField[] = [
  { key: 'holderName', autoComplete: 'cc-name', inputMode: 'text' },
  { key: 'number', autoComplete: 'cc-number', inputMode: 'numeric' },
  { key: 'expMonth', autoComplete: 'cc-exp-month', inputMode: 'numeric' },
  { key: 'expYear', autoComplete: 'cc-exp-year', inputMode: 'numeric' },
  { key: 'cvv', autoComplete: 'cc-csc', inputMode: 'numeric' },
];

const LABEL_KEYS = {
  holderName: 'card-holder',
  number: 'card-number',
  expMonth: 'card-exp-month',
  expYear: 'card-exp-year',
  cvv: 'card-cvv',
} as const satisfies Record<keyof CardFormValues, string>;

/** Campos de la tarjeta, controlados (spec 0029 §5.2). Solo presentan. */
export function CardFields({ value, onChange, disabled }: Props) {
  const t = useTranslations('checkout');

  return (
    <div className={deferredStyles.cardGrid}>
      {FIELDS.map((field) => (
        <div key={field.key} className={styles.field}>
          <label className={styles.label} htmlFor={`card-${field.key}`}>
            {t(LABEL_KEYS[field.key])}
          </label>
          <input
            id={`card-${field.key}`}
            type="text"
            autoComplete={field.autoComplete}
            inputMode={field.inputMode}
            maxLength={CARD_FIELD_MAX_LENGTH[field.key]}
            value={value[field.key]}
            onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
            disabled={disabled}
            required
            className={styles.input}
          />
        </div>
      ))}
    </div>
  );
}
