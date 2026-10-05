'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { updateBusinessSettings } from '@/lib/settings/actions';
import {
  BOOKING_CUTOFF_HOURS_MAX,
  BOOKING_CUTOFF_HOURS_MIN,
  BelowMinimumPolicy,
  DEFAULT_CHARGE_LEAD_HOURS_MAX,
  DEFAULT_CHARGE_LEAD_HOURS_MIN,
  MINIMUM_DECISION_WINDOW_HOURS_MAX,
  MINIMUM_DECISION_WINDOW_HOURS_MIN,
  SettingsActionError,
} from '@shared/constants/settings';
import type { SettingsFormResult } from '@/lib/settings/types';
import { SettingsHoursField } from './SettingsHoursField';
import styles from './settings.module.css';

type Props = {
  decisionWindowHours: number;
  chargeLeadHours: number;
  bookingCutoffHours: number;
  belowMinimumPolicy: BelowMinimumPolicy;
};

const WINDOW = { min: MINIMUM_DECISION_WINDOW_HOURS_MIN, max: MINIMUM_DECISION_WINDOW_HOURS_MAX };
const LEAD = { min: DEFAULT_CHARGE_LEAD_HOURS_MIN, max: DEFAULT_CHARGE_LEAD_HOURS_MAX };
const CUTOFF = { min: BOOKING_CUTOFF_HOURS_MIN, max: BOOKING_CUTOFF_HOURS_MAX };

/** El rango que explica cada error, según el campo que falló. */
const ERROR_RANGE: Partial<Record<SettingsActionError, { min: number; max: number }>> = {
  [SettingsActionError.LeadHoursOutOfRange]: LEAD,
  [SettingsActionError.CutoffOutOfRange]: CUTOFF,
};

export function SettingsForm({
  decisionWindowHours,
  chargeLeadHours,
  bookingCutoffHours,
  belowMinimumPolicy,
}: Props) {
  const t = useTranslations('settings');
  const [state, formAction, pending] = useActionState<SettingsFormResult | null, FormData>(
    updateBusinessSettings,
    null,
  );
  // Controlado: React 19 hace form.reset() tras la action y borraría lo tipeado si falla.
  const [hours, setHours] = useState(String(decisionWindowHours));
  const [leadHours, setLeadHours] = useState(String(chargeLeadHours));
  const [cutoffHours, setCutoffHours] = useState(String(bookingCutoffHours));
  const [policy, setPolicy] = useState<string>(belowMinimumPolicy);

  const failed = state?.success === false ? state.error : null;
  const errorRange = (failed && ERROR_RANGE[failed]) || WINDOW;

  return (
    <form action={formAction} className={styles.form}>
      <SettingsHoursField
        name="minimum_decision_window_hours"
        label={t('field-decision-window')}
        hint={t('hint-decision-window', WINDOW)}
        {...WINDOW}
        value={hours}
        onChange={setHours}
      />
      <SettingsHoursField
        name="default_charge_lead_hours"
        label={t('field-charge-lead-hours')}
        hint={t('hint-charge-lead-hours', LEAD)}
        {...LEAD}
        value={leadHours}
        onChange={setLeadHours}
      />
      <SettingsHoursField
        name="booking_cutoff_hours"
        label={t('field-booking-cutoff')}
        hint={t('hint-booking-cutoff', CUTOFF)}
        {...CUTOFF}
        value={cutoffHours}
        onChange={setCutoffHours}
      />
      <div className={styles.field}>
        <label className={styles.label}>
          {t('field-below-minimum-policy')}
          <select
            name="below_minimum_policy"
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            className={styles.input}
          >
            <option value={BelowMinimumPolicy.StaffDecides}>{t('policy-staff-decides')}</option>
            <option value={BelowMinimumPolicy.AutoCancel}>{t('policy-auto-cancel')}</option>
          </select>
        </label>
        <p className={styles.hint}>{t('hint-below-minimum-policy')}</p>
      </div>

      {failed && (
        <p className={styles.formError} role="alert">
          {t(`errors.${failed}`, errorRange)}
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
