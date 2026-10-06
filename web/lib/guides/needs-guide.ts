import { GUIDE_WARNING_TRAY_LIMIT, GUIDE_WARNING_URGENT_HOURS } from '@shared/constants/departures';
import type { Departure } from './types';

// Salidas con turistas y sin guía (spec 0043). Pura: la página trae las salidas y esto decide cuáles
// van a la bandeja. Las canceladas no llegan acá: listUpcomingDepartures ya las excluye.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const URGENT_MS = GUIDE_WARNING_URGENT_HOURS * HOUR_MS;

type GuideCheck = Pick<
  Departure,
  'startsAt' | 'liveTickets' | 'assignedGuide' | 'assignedGuideActive'
>;

/**
 * Tiene turistas y nadie que los guíe, y empieza dentro de la ventana del aviso (tiempo
 * transcurrido desde ahora). Un guía desactivado cuenta como ausente: no va a ir. La ventana la
 * configura el operador (spec 0046) y es obligatoria: la bandeja y la marca de la tabla tienen
 * que usar la misma.
 */
export function needsGuide(departure: GuideCheck, now: Date, horizonDays: number): boolean {
  const untilStart = new Date(departure.startsAt).getTime() - now.getTime();
  if (untilStart <= 0 || untilStart >= horizonDays * DAY_MS) return false;
  if (departure.liveTickets === 0) return false;
  return departure.assignedGuide === null || !departure.assignedGuideActive;
}

/** Empieza en menos de 24 horas (estricto). */
export function isGuideUrgent(departure: Pick<Departure, 'startsAt'>, now: Date): boolean {
  return new Date(departure.startsAt).getTime() - now.getTime() < URGENT_MS;
}

/** Las salidas de la bandeja, la más cercana primero, con el tope y cuántas quedaron afuera. */
export function guidelessTray<T extends GuideCheck>(
  departures: T[],
  now: Date,
  horizonDays: number,
): { shown: T[]; hidden: number } {
  const pending = departures
    .filter((d) => needsGuide(d, now, horizonDays))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return {
    shown: pending.slice(0, GUIDE_WARNING_TRAY_LIMIT),
    hidden: Math.max(0, pending.length - GUIDE_WARNING_TRAY_LIMIT),
  };
}
