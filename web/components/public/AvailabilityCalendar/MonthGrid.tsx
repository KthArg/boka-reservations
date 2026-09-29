'use client';

import { buildMonthGrid, type CalendarDay, type MonthKey } from '@/lib/public/calendar';
import styles from './AvailabilityCalendar.module.css';

type Props = {
  month: MonthKey;
  days: Map<string, CalendarDay>;
  selected: string | null;
  today: string;
  weekdays: { short: string; long: string }[];
  /** Nombre accesible de un día: fecha completa. */
  dayLabel: (day: string) => string;
  soldOutLabel: string;
  todayLabel: string;
  onSelect: (day: string) => void;
};

const DAY_NUMBER_START = 8;

/**
 * Grilla de un mes, de lunes a domingo (spec 0039). Solo los días con lugares son botones; los
 * demás son texto, sin parada de Tab.
 */
export function MonthGrid({
  month,
  days,
  selected,
  today,
  weekdays,
  dayLabel,
  soldOutLabel,
  todayLabel,
  onSelect,
}: Props) {
  const weeks = buildMonthGrid(month);

  return (
    <table className={styles.grid}>
      <thead>
        <tr>
          {weekdays.map((weekday) => (
            <th key={weekday.long} scope="col" className={styles.weekday}>
              <span aria-hidden="true">{weekday.short}</span>
              <span className={styles.srOnly}>{weekday.long}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week.find(Boolean) ?? month}>
            {week.map((day, i) => {
              if (!day) return <td key={`empty-${i}`} className={styles.cell} />;
              const info = days.get(day);
              const number = Number(day.slice(DAY_NUMBER_START));
              const isToday = day === today;
              const todayMark = isToday ? (
                <span className={styles.srOnly}>{todayLabel}</span>
              ) : null;

              if (info?.bookable) {
                const isSelected = day === selected;
                return (
                  <td key={day} className={styles.cell}>
                    <button
                      type="button"
                      className={`${styles.day} ${styles.dayBookable} ${isSelected ? styles.daySelected : ''} ${isToday ? styles.dayToday : ''}`}
                      aria-pressed={isSelected}
                      aria-label={isToday ? `${dayLabel(day)}, ${todayLabel}` : dayLabel(day)}
                      onClick={() => onSelect(day)}
                    >
                      {number}
                    </button>
                  </td>
                );
              }

              if (info) {
                return (
                  <td key={day} className={styles.cell}>
                    <span
                      className={`${styles.day} ${styles.daySoldOut} ${isToday ? styles.dayToday : ''}`}
                      title={soldOutLabel}
                    >
                      {number}
                      <span className={styles.srOnly}>{`, ${soldOutLabel}`}</span>
                      {todayMark}
                    </span>
                  </td>
                );
              }

              return (
                <td key={day} className={styles.cell}>
                  <span className={`${styles.day} ${isToday ? styles.dayToday : ''}`}>
                    {number}
                    {todayMark}
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
