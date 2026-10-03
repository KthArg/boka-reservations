'use client';

import { useTranslations } from 'next-intl';
import { DayOfWeek } from '@shared/constants/enums';
import type { ScheduleRow } from '@/lib/tours/types';
import { CAPACITY_RULE } from '@/lib/tours/number-rules';
import { NumberField } from '@/components/forms/NumberField';
import styles from './ScheduleEditor.module.css';

type Props = {
  value: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
  /** El formulario intentó guardar: mostrar los errores de campos sin tocar. */
  showErrors?: boolean;
};

const DAYS = [
  DayOfWeek.Sunday,
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
  DayOfWeek.Saturday,
] as const;

function emptyRow(): ScheduleRow {
  return { day_of_week: DayOfWeek.Monday, start_time: '08:00', capacity: 10, active: true };
}

export default function ScheduleEditor({ value, onChange, showErrors }: Props) {
  const t = useTranslations('tours');

  function update(index: number, patch: Partial<ScheduleRow>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    onChange([...value, emptyRow()]);
  }

  return (
    <div className={styles.editor}>
      <h3 className={styles.sectionTitle}>{t('schedules-section')}</h3>

      {value.length > 0 && (
        <div className={styles.rows}>
          {value.map((row, i) => (
            <div key={i} className={`${styles.row} ${!row.active ? styles.rowInactive : ''}`}>
              <label className={styles.fieldLabel}>
                {t('schedules-day')}
                <select
                  className={styles.select}
                  value={row.day_of_week}
                  onChange={(e) => update(i, { day_of_week: parseInt(e.target.value, 10) })}
                >
                  {DAYS.map((day) => (
                    <option key={day} value={day}>
                      {t(`day-${day}` as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.fieldLabel}>
                {t('schedules-start-time')}
                <input
                  type="time"
                  className={styles.input}
                  value={row.start_time}
                  onChange={(e) => update(i, { start_time: e.target.value })}
                />
              </label>

              <label className={styles.fieldLabel}>
                {t('schedules-capacity')}
                <NumberField
                  className={styles.input}
                  value={row.capacity}
                  onChange={(capacity) => update(i, { capacity })}
                  rule={CAPACITY_RULE}
                  mode="report"
                  errorMessage={t('schedules-capacity-invalid')}
                  forceError={showErrors}
                  errorClassName={styles.error}
                />
              </label>

              <label className={styles.fieldLabel}>
                {t('schedules-valid-from')}
                <input
                  type="date"
                  className={styles.input}
                  value={row.valid_from ?? ''}
                  onChange={(e) => update(i, { valid_from: e.target.value || undefined })}
                />
              </label>

              <label className={styles.fieldLabel}>
                {t('schedules-valid-until')}
                <input
                  type="date"
                  className={styles.input}
                  value={row.valid_until ?? ''}
                  onChange={(e) => update(i, { valid_until: e.target.value || null })}
                />
              </label>

              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={row.active}
                  onChange={(e) => update(i, { active: e.target.checked })}
                />
                {t('schedules-active')}
              </label>
            </div>
          ))}
        </div>
      )}

      {/* Spec 0044: las fechas en día de Costa Rica; cambiar día u hora no retira salidas viejas. */}
      <p className={styles.hint}>{t('schedules-validity-hint')}</p>
      {value.some((row) => row.id) ? (
        <p className={styles.hint}>{t('schedules-existing-hint')}</p>
      ) : null}

      <button type="button" className={styles.addBtn} onClick={addRow}>
        + {t('schedules-add-row')}
      </button>
    </div>
  );
}
