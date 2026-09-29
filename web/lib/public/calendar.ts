/**
 * Lógica pura del calendario de fechas del tour (spec 0039). Todo trabaja con días de Costa Rica
 * ya calculados en el servidor ('YYYY-MM-DD'), así que no depende de la zona horaria del
 * navegador ni de la de quien corre los tests.
 */

/** Una salida tal como viaja al navegador: lo mínimo, con la hora ya formateada. */
export type CalendarDeparture = {
  id: string;
  /** Día de Costa Rica, 'YYYY-MM-DD'. */
  crDay: string;
  /** Hora formateada en el servidor, en el idioma de la página. */
  time: string;
  seatsLeft: number;
};

export type CalendarDay = {
  day: string;
  departures: CalendarDeparture[];
  /** Tiene al menos una salida con lugares. */
  bookable: boolean;
};

/** Mes 'YYYY-MM'. */
export type MonthKey = string;

const MONTH_KEY_LENGTH = 7;
const DAYS_PER_WEEK = 7;
const DAY_DIGITS = 2;
/** Días de la semana ISO, de 1 (lunes) a 7 (domingo): el orden de las columnas de la grilla. */
export const ISO_WEEKDAYS: readonly number[] = Array.from(
  { length: DAYS_PER_WEEK },
  (_, i) => i + 1,
);
/** getUTCDay() empieza en domingo (0); la grilla empieza en lunes. */
const MONDAY_OFFSET = 6;

/** Lugares de una salida. Nada pasa una salida a `full`: las llenas llegan con 0 lugares. */
export function seatsLeft(capacityTotal: number, capacityReserved: number): number {
  return Math.max(0, capacityTotal - capacityReserved);
}

export function monthOf(day: string): MonthKey {
  return day.slice(0, MONTH_KEY_LENGTH);
}

/**
 * Agrupa por día de Costa Rica. Las salidas llegan ordenadas por hora de inicio (la consulta
 * ordena por `starts_at`), y el orden se conserva dentro de cada día.
 */
export function groupByCrDay(departures: CalendarDeparture[]): Map<string, CalendarDay> {
  const days = new Map<string, CalendarDay>();
  for (const departure of departures) {
    const day = days.get(departure.crDay) ?? {
      day: departure.crDay,
      departures: [],
      bookable: false,
    };
    day.departures.push(departure);
    day.bookable ||= departure.seatsLeft > 0;
    days.set(departure.crDay, day);
  }
  return days;
}

function bookableDays(days: Map<string, CalendarDay>): string[] {
  return [...days.values()]
    .filter((d) => d.bookable)
    .map((d) => d.day)
    .sort();
}

/** Primer y último mes con al menos un día con lugares; null si no hay ninguno. */
export function monthsRange(
  days: Map<string, CalendarDay>,
): { first: MonthKey; last: MonthKey } | null {
  const bookable = bookableDays(days);
  if (bookable.length === 0) return null;
  return { first: monthOf(bookable[0]), last: monthOf(bookable[bookable.length - 1]) };
}

/** Primer día con lugares, en todo el rango o dentro de un mes. */
export function firstBookableDay(days: Map<string, CalendarDay>, month?: MonthKey): string | null {
  const bookable = bookableDays(days).filter((d) => month === undefined || monthOf(d) === month);
  return bookable[0] ?? null;
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
  return date.toISOString().slice(0, MONTH_KEY_LENGTH);
}

/**
 * Semanas del mes, de lunes a domingo. Cada celda es el día 'YYYY-MM-DD' o null (relleno antes
 * del primer día y después del último). Con UTC: no depende de la zona de quien lo ejecuta.
 */
export function buildMonthGrid(month: MonthKey): (string | null)[][] {
  const [year, monthIndex] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const leading = (first.getUTCDay() + MONDAY_OFFSET) % DAYS_PER_WEEK;

  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${month}-${String(d).padStart(DAY_DIGITS, '0')}`);
  }
  while (cells.length % DAYS_PER_WEEK !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += DAYS_PER_WEEK) {
    weeks.push(cells.slice(i, i + DAYS_PER_WEEK));
  }
  return weeks;
}

/** Día de la semana de un día 'YYYY-MM-DD', de 1 (lunes) a 7 (domingo). */
export function isoWeekday(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return weekday === 0 ? DAYS_PER_WEEK : weekday;
}
