import { getTranslations } from 'next-intl/server';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import type { Departure } from '@/lib/guides/types';
import { CancelDepartureDialog } from './CancelDepartureDialog';
import { KeepDepartureButton } from './KeepDepartureButton';
import styles from './departures.module.css';

/**
 * Salidas bajo el mínimo cuyo corte cae en las próximas 72 horas (spec 0035). Si nadie decide, el
 * proceso del worker las cancela solas un día antes, con reembolso del 100 %.
 */
export async function MinimumTray({ departures }: { departures: Departure[] }) {
  const t = await getTranslations('operations');
  const pending = departures.filter((d) => d.minimum.needsDecision);
  if (pending.length === 0) return null;

  return (
    <section className={styles.tray}>
      <h2 className={styles.trayTitle}>{t('minimum-tray-title')}</h2>
      <p className={styles.trayIntro}>{t('minimum-tray-intro')}</p>
      <ul className={styles.trayList}>
        {pending.map((departure) => {
          const { date, time } = formatOperatorDateTime(departure.startsAt);
          const cutoff = formatOperatorDateTime(departure.minimum.cutoffAt);
          return (
            <li key={departure.id} className={styles.trayItem}>
              <div>
                <p className={styles.trayTour}>{departure.tourName}</p>
                <p className={styles.trayMeta}>
                  {date} {time} ·{' '}
                  {t('minimum-seats', {
                    seats: departure.minimum.seats,
                    minimum: departure.minimum.minimum,
                    cutoff: `${cutoff.date} ${cutoff.time}`,
                  })}
                </p>
              </div>
              <div className={styles.decision}>
                <KeepDepartureButton instanceId={departure.id} />
                <CancelDepartureDialog
                  instanceId={departure.id}
                  canCancelForMinimum={departure.minimum.canCancelForMinimum}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
