'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { updateBusinessSettings } from '@/lib/settings/actions';
import {
  MINIMUM_DECISION_WINDOW_HOURS_MAX,
  MINIMUM_DECISION_WINDOW_HOURS_MIN,
} from '@shared/constants/settings';
import type { SettingsFormResult } from '@/lib/settings/types';
import styles from './settings.module.css';

type Props = { decisionWindowHours: number };

const RANGE = { min: MINIMUM_DECISION_WINDOW_HOURS_MIN, max: MINIMUM_DECISION_WINDOW_HOURS_MAX };

export function SettingsForm({ decisionWindowHours }: Props) {
  const t = useTranslations('settings');
  const [state, formAction, pending] = useActionState<SettingsFormResult | null, FormData>(
    updateBusinessSettings,
    null,
  );
  // Controlado: React 19 hace form.reset() tras la action y borraría lo tipeado si falla.
  const [hours, setHours] = useState(String(decisionWindowHours));

  return (
    <form action={formAction} className={styles.form}>
      <label className={styles.label}>
        {t('field-decision-window')}
        <input
          type="number"
          name="minimum_decision_window_hours"
          required
          step={1}
          min={RANGE.min}
          max={RANGE.max}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className={styles.input}
        />
      </label>
      <p className={styles.hint}>{t('hint-decision-window', RANGE)}</p>

      {state?.success === false && (
        <p className={styles.formError} role="alert">
          {t(`errors.${state.error}`, RANGE)}
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
