/**
 * Turno de un tour o de una salida: de día o de noche (spec 0042 §5.3). Se deriva de la hora de
 * inicio en Costa Rica; no hay un campo en el esquema. Puro y sin `server-only`: el calendario,
 * que corre en el navegador, usa el tipo.
 */

export type Shift = 'day' | 'night';
/** Un tour con horarios de los dos turnos es 'both'. */
export type TourShift = Shift | 'both';

/** Desde las 17:00 ya es de noche (la caminata nocturna de la landing sale a las 17:30). */
const NIGHT_STARTS_HOUR = 17;
/** Hasta las 04:59 sigue siendo de noche. */
const DAY_STARTS_HOUR = 5;

/** Turno de una hora local de Costa Rica, 'HH:MM' o 'HH:MM:SS'. */
export function shiftOfTime(time: string): Shift {
  const hour = Number(time.slice(0, 2));
  return hour >= NIGHT_STARTS_HOUR || hour < DAY_STARTS_HOUR ? 'night' : 'day';
}

/** Turno de un tour según las horas de inicio de sus horarios; null si no tiene horarios. */
export function shiftOfTour(startTimes: readonly string[]): TourShift | null {
  if (startTimes.length === 0) return null;
  const shifts = new Set(startTimes.map(shiftOfTime));
  if (shifts.size > 1) return 'both';
  return shifts.has('night') ? 'night' : 'day';
}
