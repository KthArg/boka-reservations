import { SUCCESS_PAGE_WINDOW_HOURS } from '@shared/constants/bookings';

const MS_PER_HOUR = 3_600_000;
const WINDOW_MS = SUCCESS_PAGE_WINDOW_HOURS * MS_PER_HOUR;

type SuccessWindowInput = {
  createdAt: string;
  /** Null en toda reserva con cobro inmediato: la regla no puede depender de que exista. */
  chargeStartedAt: string | null;
  now: Date;
};

/**
 * Si /checkout/success puede mostrar los datos de la reserva (spec 0031 §5.3). La referencia es
 * lo más reciente entre la creación y el último inicio de cobro: el cobro manual o automático usa
 * esta página como regreso de la verificación 3DS, días o semanas después de crear la reserva.
 * Con el plazo justo se muestra; con cualquier tiempo mayor, no.
 */
export function isWithinSuccessWindow({
  createdAt,
  chargeStartedAt,
  now,
}: SuccessWindowInput): boolean {
  const created = new Date(createdAt).getTime();
  const chargeStarted = chargeStartedAt ? new Date(chargeStartedAt).getTime() : Number.NaN;
  const reference = Number.isNaN(chargeStarted) ? created : Math.max(created, chargeStarted);
  if (Number.isNaN(reference)) return false;
  return now.getTime() - reference <= WINDOW_MS;
}
