'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  addMonths,
  firstBookableDay,
  ISO_WEEKDAYS,
  groupByCrDay,
  isoWeekday,
  monthOf,
  monthsRange,
  type CalendarDeparture,
  type MonthKey,
} from './calendar';
import { MonthGrid } from './MonthGrid';
import { DayDepartures } from './DayDepartures';
import styles from './AvailabilityCalendar.module.css';

type Props = {
  departures: CalendarDeparture[];
  /** Hoy en Costa Rica, calculado en el servidor. */
  today: string;
  tourSlug: string;
};

/**
 * Calendario mensual de salidas del tour (spec 0039). Los nombres de meses y días salen de los
 * archivos de idioma, no de `Intl`: su texto cambia entre Node y cada navegador y el HTML del
 * servidor no coincidiría con el del navegador.
 */
export function AvailabilityCalendar({ departures, today, tourSlug }: Props) {
  const locale = useLocale();
  const t = useTranslations('public');
  const days = useMemo(() => groupByCrDay(departures), [departures]);
  const range = useMemo(() => monthsRange(days), [days]);
  const [month, setMonth] = useState<MonthKey | null>(range?.first ?? null);
  const [selected, setSelected] = useState<string | null>(() => firstBookableDay(days));

  if (!range || !month) return <p className={styles.empty}>{t('detail-no-instances')}</p>;

  const monthName = (m: number) => t(`calendar-month-${m}` as Parameters<typeof t>[0]);
  const weekdayName = (d: number, form: 'short' | 'long') =>
    t(`calendar-weekday-${form}-${d}` as Parameters<typeof t>[0]);
  const dayLabel = (day: string) => {
    const [, m, d] = day.split('-').map(Number);
    return t('calendar-day-title', {
      weekday: weekdayName(isoWeekday(day), 'long'),
      day: d,
      month: monthName(m),
    });
  };

  const goTo = (target: MonthKey) => {
    setMonth(target);
    setSelected(firstBookableDay(days, target));
  };

  const [year, monthNumber] = month.split('-').map(Number);
  const selectedDay = selected && monthOf(selected) === month ? (days.get(selected) ?? null) : null;

  return (
    <div className={styles.calendar}>
      <div className={styles.monthNav}>
        <button
          type="button"
          className={styles.navButton}
          aria-label={t('calendar-prev-month')}
          disabled={month <= range.first}
          onClick={() => goTo(addMonths(month, -1))}
        >
          ‹
        </button>
        <h3 className={styles.monthLabel} aria-live="polite">
          {`${monthName(monthNumber)} ${year}`}
        </h3>
        <button
          type="button"
          className={styles.navButton}
          aria-label={t('calendar-next-month')}
          disabled={month >= range.last}
          onClick={() => goTo(addMonths(month, 1))}
        >
          ›
        </button>
      </div>

      <MonthGrid
        month={month}
        days={days}
        selected={selected}
        today={today}
        weekdays={ISO_WEEKDAYS.map((d) => ({
          short: weekdayName(d, 'short'),
          long: weekdayName(d, 'long'),
        }))}
        dayLabel={dayLabel}
        soldOutLabel={t('calendar-sold-out')}
        todayLabel={t('calendar-today')}
        onSelect={setSelected}
      />

      <DayDepartures
        day={selectedDay}
        title={selectedDay ? dayLabel(selectedDay.day) : null}
        checkoutHref={(id) => `/${locale}/tours/${tourSlug}/checkout?instance=${id}`}
      />
    </div>
  );
}
