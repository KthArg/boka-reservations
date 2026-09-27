import { getTranslations } from 'next-intl/server';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import {
  DepartureChargeState,
  type DepartureCharge,
  type DepartureChargeStateValue,
} from '@/lib/guides/types';
import { DepartureResolution } from '@shared/constants/departures';
import styles from './departures.module.css';

const STATE_LABEL: Record<DepartureChargeStateValue, string> = {
  [DepartureChargeState.Idle]: 'state-idle',
  [DepartureChargeState.Charging]: 'state-charging',
  [DepartureChargeState.AwaitingDecision]: 'state-awaiting',
  [DepartureChargeState.Resolved]: 'state-resolved',
};

// La resolución llega como texto de la base: se mapea explícitamente para no armar una clave de
// traducción que puede no existir, y para que las claves sigan el kebab-case del resto.
const RESOLUTION_LABEL: Record<string, string> = {
  [DepartureResolution.Reached]: 'resolution-reached',
  [DepartureResolution.AutoCancelled]: 'resolution-auto-cancelled',
  [DepartureResolution.StaffConfirmed]: 'resolution-staff-confirmed',
  [DepartureResolution.StaffCancelled]: 'resolution-staff-cancelled',
};

/**
 * Estado del cobro de una salida en la tabla (spec 0033 §5.12): en qué anda el ciclo y cuántos
 * cupos tienen la plata retenida o cobrada contra el mínimo que hay que alcanzar.
 */
export async function ChargeStatus({ charge }: { charge: DepartureCharge }) {
  const t = await getTranslations('departures');
  const resolution = charge.resolution === null ? undefined : RESOLUTION_LABEL[charge.resolution];
  // El plazo solo dice algo mientras el ciclo corre: después ya pasó o no aplica.
  const deadline =
    charge.state === DepartureChargeState.Charging && charge.deadline !== null
      ? formatOperatorDateTime(charge.deadline)
      : null;
  const label =
    charge.state === DepartureChargeState.Resolved && resolution
      ? t(resolution)
      : t(STATE_LABEL[charge.state]);

  return (
    <span className={styles.charge}>
      <span className={styles.chargeState}>{label}</span>
      {charge.state !== DepartureChargeState.Idle && (
        <span className={styles.chargeSeats}>
          {t('seats', { authorized: charge.authorizedTickets, minimum: charge.minimum })}
        </span>
      )}
      {deadline && (
        <span className={styles.chargeSeats}>
          {t('deadline', { date: deadline.date, time: deadline.time })}
        </span>
      )}
    </span>
  );
}
