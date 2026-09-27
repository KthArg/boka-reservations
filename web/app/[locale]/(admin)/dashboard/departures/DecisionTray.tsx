import { getTranslations } from 'next-intl/server';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import { DepartureChargeState, type Departure } from '@/lib/guides/types';
import { DepartureDecision } from './DepartureDecision';
import styles from './departures.module.css';

/**
 * Bandeja de decisión (spec 0033 §5.12): las salidas cuyo plazo venció sin alcanzar el mínimo.
 * Mientras están acá no hay plata retenida —las autorizaciones ya se soltaron— y la salida no se
 * cancela sola, salvo la red terminal del worker a 3 h de la fecha.
 */
export async function DecisionTray({ departures }: { departures: Departure[] }) {
  const t = await getTranslations('departures');
  const pending = departures.filter(
    (d) => d.charge.state === DepartureChargeState.AwaitingDecision,
  );
  if (pending.length === 0) return null;

  return (
    <section className={styles.tray}>
      <h2 className={styles.trayTitle}>{t('tray-title')}</h2>
      <p className={styles.trayIntro}>{t('tray-intro')}</p>
      <ul className={styles.trayList}>
        {pending.map((departure) => {
          const { date, time } = formatOperatorDateTime(departure.startsAt);
          return (
            <li key={departure.id} className={styles.trayItem}>
              <div>
                <p className={styles.trayTour}>{departure.tourName}</p>
                <p className={styles.trayMeta}>
                  {date} {time} ·{' '}
                  {t('seats', {
                    authorized: departure.charge.authorizedTickets,
                    minimum: departure.charge.minimum,
                  })}
                </p>
              </div>
              <DepartureDecision instanceId={departure.id} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
