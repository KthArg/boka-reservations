'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { updateOperatorSettings } from '@/lib/settings/operator-actions';
import {
  OPERATOR_TEXT_FIELDS,
  type OperatorSettingsForm as OperatorValues,
  type OperatorTextField,
} from '@/lib/settings/operator-types';
import {
  NO_SHOW_TOLERANCE_MINUTES_MAX,
  NO_SHOW_TOLERANCE_MINUTES_MIN,
  OPERATOR_FIELD_MAX_LENGTH,
} from '@shared/constants/settings';
import type { SettingsFormResult } from '@/lib/settings/types';
import { SettingsHoursField } from './SettingsHoursField';
import styles from './settings.module.css';

type Props = { initial: OperatorValues };

const EMAIL_FIELDS: ReadonlySet<OperatorTextField> = new Set([
  'operator_contact_email',
  'operator_privacy_email',
]);

const TOLERANCE = { min: NO_SHOW_TOLERANCE_MINUTES_MIN, max: NO_SHOW_TOLERANCE_MINUTES_MAX };

/**
 * Datos del operador y tolerancia de llegada tarde (spec 0034). Los usan los términos, el aviso de
 * privacidad, el pie del sitio y de los correos, y el resumen de compra; la venta en línea se
 * habilita recién cuando están todos los obligatorios. Campos controlados: React 19 hace
 * form.reset() tras la action y borraría lo escrito si la validación falla.
 */
export function OperatorSettingsForm({ initial }: Props) {
  const t = useTranslations('settings');
  const [state, formAction, pending] = useActionState<SettingsFormResult | null, FormData>(
    updateOperatorSettings,
    null,
  );
  const [values, setValues] = useState(initial);

  const setText = (field: OperatorTextField, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const failed = state?.success === false ? state.error : null;

  return (
    <form action={formAction} className={styles.form}>
      <p className={styles.hint}>{t('operator-intro')}</p>

      {OPERATOR_TEXT_FIELDS.map((field) => (
        <div key={field} className={styles.field}>
          <label className={styles.label}>
            {t(`field-${field}`)}
            <input
              type={EMAIL_FIELDS.has(field) ? 'email' : 'text'}
              name={field}
              maxLength={OPERATOR_FIELD_MAX_LENGTH}
              value={values[field]}
              onChange={(e) => setText(field, e.target.value)}
              className={styles.input}
            />
          </label>
          <p className={styles.hint}>{t(`hint-${field}`)}</p>
        </div>
      ))}

      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          name="operator_has_liability_policy"
          checked={values.operator_has_liability_policy}
          onChange={(e) =>
            setValues((current) => ({
              ...current,
              operator_has_liability_policy: e.target.checked,
            }))
          }
        />
        {t('field-operator_has_liability_policy')}
      </label>

      <SettingsHoursField
        name="no_show_tolerance_minutes"
        label={t('field-no-show-tolerance')}
        hint={t('hint-no-show-tolerance', TOLERANCE)}
        {...TOLERANCE}
        value={String(values.no_show_tolerance_minutes)}
        onChange={(value) =>
          setValues((current) => ({ ...current, no_show_tolerance_minutes: Number(value) }))
        }
      />

      {failed && (
        <p className={styles.formError} role="alert">
          {t(`errors.${failed}`, TOLERANCE)}
        </p>
      )}
      {state?.success && (
        <p className={styles.saved} role="status">
          {t('saved')}
        </p>
      )}

      <button type="submit" disabled={pending} className={styles.submitBtn}>
        {pending ? '…' : t('submit')}
      </button>
    </form>
  );
}
