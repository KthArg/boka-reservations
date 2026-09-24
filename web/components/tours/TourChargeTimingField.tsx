import { useTranslations } from 'next-intl';
import {
  CHARGE_LEAD_HOURS_MAX,
  CHARGE_LEAD_HOURS_MIN,
  CHARGE_LEAD_HOURS_WARN_BELOW,
  ChargeTiming,
} from '@shared/constants/tours';
import styles from './TourForm.module.css';

type Props = {
  timing: ChargeTiming;
  leadHours: string;
  /** `business_settings.default_charge_lead_hours`: lo que rige si el tour deja el campo vacío. */
  defaultLeadHours: number;
  onTimingChange: (timing: ChargeTiming) => void;
  onLeadHoursChange: (hours: string) => void;
  errors?: string[];
};

const OPTIONS = [
  { value: ChargeTiming.OnMinimum, label: 'charge-timing-on-minimum' },
  { value: ChargeTiming.BeforeDeparture, label: 'charge-timing-before-departure' },
] as const;

const RANGE = { min: CHARGE_LEAD_HOURS_MIN, max: CHARGE_LEAD_HOURS_MAX };

// Momento del cobro del tour (spec 0033 §5.1 y §5.12). Los dos campos son controlados: React 19
// hace form.reset() tras la action y un input no controlado perdería lo elegido al fallar una
// validación. El de horas solo se renderiza con "antes de la salida", así que con "al cumplirse
// el mínimo" el FormData no lo lleva y la columna queda en NULL (= valor global de respaldo).
export default function TourChargeTimingField({
  timing,
  leadHours,
  defaultLeadHours,
  onTimingChange,
  onLeadHoursChange,
  errors,
}: Props) {
  const t = useTranslations('tours');
  const hours = Number(leadHours);
  const isShortLead =
    leadHours !== '' && hours >= RANGE.min && hours < CHARGE_LEAD_HOURS_WARN_BELOW;

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{t('charge-timing-section')}</legend>

      <label className={styles.label}>
        {t('field-charge-timing')}
        <select
          name="charge_timing"
          className={styles.input}
          value={timing}
          onChange={(e) => onTimingChange(e.target.value as ChargeTiming)}
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </label>
      <p className={styles.hint}>{t('hint-charge-timing')}</p>

      {timing === ChargeTiming.BeforeDeparture && (
        <>
          <label className={styles.label}>
            {t('field-charge-lead-hours')}
            <input
              type="number"
              name="charge_lead_hours"
              className={styles.input}
              step={1}
              min={RANGE.min}
              max={RANGE.max}
              placeholder={String(defaultLeadHours)}
              value={leadHours}
              onChange={(e) => onLeadHoursChange(e.target.value)}
            />
            {errors?.map((e) => (
              <span key={e} className={styles.fieldError}>
                {e}
              </span>
            ))}
          </label>
          <p className={styles.hint}>
            {t('hint-charge-lead-hours', { ...RANGE, default: defaultLeadHours })}
          </p>
          {isShortLead && (
            <p className={styles.warn} role="status">
              {t('warn-charge-lead-hours', { hours: CHARGE_LEAD_HOURS_WARN_BELOW })}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
