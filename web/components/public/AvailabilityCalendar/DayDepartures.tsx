'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LOW_SEATS_THRESHOLD } from '@shared/constants/bookings';
import type { CalendarDay } from '@/lib/public/calendar';
import styles from './AvailabilityCalendar.module.css';

type Props = {
  day: CalendarDay | null;
  title: string | null;
  checkoutHref: (instanceId: string) => string;
};

/** Horarios del día elegido con sus lugares y el acceso al checkout (spec 0039). */
export function DayDepartures({ day, title, checkoutHref }: Props) {
  const t = useTranslations('public');

  return (
    <div className={styles.dayPanel} aria-live="polite">
      {day && title ? (
        <>
          <h3 className={styles.dayTitle}>{title}</h3>
          <ul className={styles.dateList}>
            {day.departures.map((departure) => {
              const soldOut = departure.seatsLeft === 0;
              const low = !soldOut && departure.seatsLeft <= LOW_SEATS_THRESHOLD;
              return (
                <li key={departure.id} className={styles.dateItem}>
                  <span className={styles.dateLabel}>{departure.time}</span>
                  <span className={low ? styles.seatsLow : styles.seats}>
                    {soldOut
                      ? t('calendar-sold-out')
                      : t(low ? 'calendar-seats-low' : 'calendar-seats-left', {
                          count: departure.seatsLeft,
                        })}
                  </span>
                  {soldOut ? null : (
                    <Link href={checkoutHref(departure.id)} className={styles.bookLink}>
                      {t('detail-book-cta')}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className={styles.empty}>{t('calendar-no-departures-month')}</p>
      )}
    </div>
  );
}
