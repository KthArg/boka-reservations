import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicInstance } from '@/lib/public/tours';
import styles from './AvailabilityCalendar.module.css';

type Props = { instances: PublicInstance[]; tourSlug: string };

type InstanceRow = { id: string; label: string };
type MonthGroup = { label: string; rows: InstanceRow[] };

function groupByMonth(instances: PublicInstance[], locale: string): MonthGroup[] {
  const groups = new Map<string, InstanceRow[]>();

  for (const inst of instances) {
    const date = new Date(inst.starts_at);
    const lcTag = locale === 'es' ? 'es-CR' : 'en-US';
    const monthKey = date.toLocaleDateString(lcTag, {
      year: 'numeric',
      month: 'long',
      timeZone: 'America/Costa_Rica',
    });
    const dateLabel = date.toLocaleDateString(lcTag, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Costa_Rica',
    });

    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey)!.push({ id: inst.id, label: dateLabel });
  }

  return Array.from(groups.entries()).map(([label, rows]) => ({ label, rows }));
}

export function AvailabilityCalendar({ instances, tourSlug }: Props) {
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
            {group.rows.map((row) => (
              <li key={row.id} className={styles.dateItem}>
                <span className={styles.dateLabel}>{row.label}</span>
                <Link
                  href={`/${locale}/tours/${tourSlug}/checkout?instance=${row.id}`}
                  className={styles.bookLink}
                >
                  {t('detail-book-cta')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
