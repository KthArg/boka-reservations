import { getTranslations } from 'next-intl/server';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import { guidelessTray, isGuideUrgent } from '@/lib/guides/needs-guide';
import type { AssignableGuide, Departure } from '@/lib/guides/types';
import { GuideAssigner } from './GuideAssigner';
import styles from './departures.module.css';

type Props = { departures: Departure[]; guides: AssignableGuide[]; now: Date };

/**
 * Salidas próximas con turistas y sin guía (spec 0043). Va primera en la página: una salida sin
 * guía es lo que más rápido se vuelve irreversible. Se asigna desde acá con el mismo selector.
 */
export async function GuidelessTray({ departures, guides, now }: Props) {
  const t = await getTranslations('guides');
  const { shown, hidden } = guidelessTray(departures, now);
  if (shown.length === 0) return null;

  return (
    <section className={styles.tray}>
      <h2 className={styles.trayTitle}>{t('guideless-tray-title')}</h2>
      <p className={styles.trayIntro}>{t('guideless-tray-intro')}</p>
      <ul className={styles.trayList}>
        {shown.map((departure) => {
          const { date, time } = formatOperatorDateTime(departure.startsAt);
          return (
            <li key={departure.id} className={styles.trayItem}>
              <div>
                <p className={styles.trayTour}>
                  {departure.tourName}
                  {isGuideUrgent(departure, now) ? (
                    <span className={styles.urgentBadge}>{t('guideless-urgent')}</span>
                  ) : null}
                </p>
                <p className={styles.trayMeta}>
                  {date} {time} · {t('guideless-seats', { seats: departure.liveTickets })}
                </p>
              </div>
              <GuideAssigner
                instanceId={departure.id}
                guides={guides}
                assignedGuideId={departure.assignedGuide?.id ?? null}
              />
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <p className={styles.trayMeta}>{t('guideless-more', { count: hidden })}</p>
      ) : null}
    </section>
  );
}
