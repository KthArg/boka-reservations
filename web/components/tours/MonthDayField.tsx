'use client';

import { useTranslations } from 'next-intl';
import { DAYS_IN_MONTH, monthDay, type MonthDay } from '@/lib/pricing/season';
import { MONTH_KEYS } from '@/lib/public/calendar-keys';
import styles from './PricingEditor.module.css';

type Props = {
  label: string;
  value: MonthDay;
  onChange: (value: MonthDay) => void;
};

/**
 * Día y mes de una temporada, sin año (spec 0040). El selector de día solo ofrece los días del
 * mes elegido: al cambiar a un mes más corto, el día se ajusta al último que existe.
 */
export function MonthDayField({ label, value, onChange }: Props) {
  const t = useTranslations('tours');
  const tPublic = useTranslations('public');
  const [month, day] = value.split('-').map(Number);
  const maxDay = DAYS_IN_MONTH[month - 1];

  return (
    <fieldset className={styles.monthDay}>
      <legend className={styles.fieldLabel}>{label}</legend>
      <select
        className={styles.select}
        aria-label={`${label}: ${t('pricing-day')}`}
        value={day}
        onChange={(e) => onChange(monthDay(month, Number(e.target.value)))}
      >
        {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        aria-label={`${label}: ${t('pricing-month')}`}
        value={month}
        onChange={(e) => {
          const nextMonth = Number(e.target.value);
          onChange(monthDay(nextMonth, Math.min(day, DAYS_IN_MONTH[nextMonth - 1])));
        }}
      >
        {MONTH_KEYS.map((key, i) => (
          <option key={key} value={i + 1}>
            {tPublic(key)}
          </option>
        ))}
      </select>
    </fieldset>
  );
}
