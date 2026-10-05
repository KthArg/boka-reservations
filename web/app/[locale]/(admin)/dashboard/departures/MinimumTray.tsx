import { getTranslations } from 'next-intl/server';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import type { Departure } from '@/lib/guides/types';
import { BelowMinimumPolicy } from '@shared/constants/settings';
import { CancelDepartureDialog } from './CancelDepartureDialog';
import { KeepDepartureButton } from './KeepDepartureButton';
import styles from './departures.module.css';

type Props = { departures: Departure[]; policy: BelowMinimumPolicy };

/**
 * Salidas con reservas y bajo el mínimo cuyo corte cae en las próximas 72 horas (specs 0035 y
 * 0045). Si nadie decide, manda la política del negocio: con `staff_decides` la salida se hace;
 * con `auto_cancel` el worker la cancela sola un día antes, con reembolso del 100 %.
 */
export async function MinimumTray({ departures, policy }: Props) {
  const t = await getTranslations('operations');
  const auto = policy === BelowMinimumPolicy.AutoCancel;
  const pending = departures.filter((d) => d.minimum.needsDecision);
  if (pending.length === 0) return null;

  return (
    <section className={styles.tray}>
      <h2 className={styles.trayTitle}>{t('minimum-tray-title')}</h2>
      <p className={styles.trayIntro}>
        {t(auto ? 'minimum-tray-intro' : 'minimum-tray-intro-staff')}
      </p>
      <ul className={styles.trayList}>
        {pending.map((departure) => {
          const { date, time } = formatOperatorDateTime(departure.startsAt);
          const { minimum } = departure;
          const cutoff = formatOperatorDateTime(auto ? minimum.cutoffAt : minimum.noticeLimitAt);
          const seatsKey = auto
            ? 'minimum-seats'
            : minimum.canCancelForMinimum
              ? 'minimum-seats-staff'
              : 'minimum-seats-late';
          return (
            <li key={departure.id} className={styles.trayItem}>
              <div>
                <p className={styles.trayTour}>{departure.tourName}</p>
                <p className={styles.trayMeta}>
                  {date} {time} ·{' '}
                  {t(seatsKey, {
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
                  minimumResolved={departure.minimum.resolved}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
