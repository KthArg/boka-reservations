import { useLocale, useTranslations } from 'next-intl';
import type { PublicInstance } from '@/lib/public/tours';
import styles from './AvailabilityCalendar.module.css';

type Props = { instances: PublicInstance[] };

type MonthGroup = { label: string; dates: string[] };

function groupByMonth(instances: PublicInstance[], locale: string): MonthGroup[] {
  const groups = new Map<string, string[]>();

  for (const inst of instances) {
    const date = new Date(inst.starts_at);
    const monthKey = date.toLocaleDateString(locale === 'es' ? 'es-CR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      timeZone: 'America/Costa_Rica',
    });
    const dateLabel = date.toLocaleDateString(locale === 'es' ? 'es-CR' : 'en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Costa_Rica',
    });

    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey)!.push(dateLabel);
  }

  return Array.from(groups.entries()).map(([label, dates]) => ({ label, dates }));
}

export function AvailabilityCalendar({ instances }: Props) {
  const locale = useLocale();
  const t = useTranslations('public');

  if (instances.length === 0) {
    return <p className={styles.empty}>{t('detail-no-instances')}</p>;
  }

  const groups = groupByMonth(instances, locale);

  return (
    <div className={styles.calendar}>
      {groups.map((group) => (
        <section key={group.label} className={styles.month}>
          <h3 className={styles.monthLabel}>{group.label}</h3>
          <ul className={styles.dateList}>
            {group.dates.map((d) => (
              <li key={d} className={styles.dateItem}>
                {d}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
