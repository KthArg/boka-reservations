/**
 * Turno de una salida: de día o de noche. Con los dos tours fijos (spec 0047 §5.6) lo define el
 * tour: una salida del diurno es de día a cualquier hora. Un tour viejo, sin `kind`, conserva la
 * derivación por hora de inicio en Costa Rica (spec 0042 §5.3). Puro y sin `server-only`: el
 * calendario, que corre en el navegador, usa el tipo.
 */

import type { TourKind } from '@shared/constants/enums';

/** Los turnos son los mismos dos valores que el `kind` de los tours fijos. */
export type Shift = TourKind;

/** Desde las 17:00 ya es de noche (la caminata nocturna de la landing sale a las 17:30). */
const NIGHT_STARTS_HOUR = 17;
/** Hasta las 04:59 sigue siendo de noche. */
const DAY_STARTS_HOUR = 5;

/** Turno de una hora local de Costa Rica, 'HH:MM' o 'HH:MM:SS'. */
export function shiftOfTime(time: string): Shift {
  const hour = Number(time.slice(0, 2));
  return hour >= NIGHT_STARTS_HOUR || hour < DAY_STARTS_HOUR ? 'night' : 'day';
}

/** Turno de una salida: el `kind` de su tour, o la hora si el tour no es uno de los fijos. */
export function shiftOfDeparture(kind: Shift | null | undefined, time: string): Shift {
  return kind ?? shiftOfTime(time);
}
