/**
 * Temporadas de precio que se repiten cada año (spec 0040). Una temporada es un rango día-mes
 * `MM-DD`, sin año, que puede cruzar el fin de año. La comparación de texto `MM-DD` respeta el
 * orden del calendario, así que no hace falta convertir a fechas.
 */

/** Día-mes 'MM-DD'. */
export type MonthDay = string;

/** Días máximos de cada mes (febrero con 29: la temporada puede incluirlo). */
// eslint-disable-next-line no-magic-numbers -- tabla del calendario, no números sueltos
export const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const MD_START = 5;
const TWO_DIGITS = 2;
const YEAR_DAYS = 366;
const FIRST_DAY: MonthDay = '01-01';
const LAST_DAY: MonthDay = '12-31';

export function isValidMonthDay(md: string): boolean {
  const match = MONTH_DAY.exec(md);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  return month >= 1 && month <= DAYS_IN_MONTH.length && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

export function monthDay(month: number, day: number): MonthDay {
  return `${String(month).padStart(TWO_DIGITS, '0')}-${String(day).padStart(TWO_DIGITS, '0')}`;
}

/** El día-mes de una fecha de Costa Rica 'YYYY-MM-DD'. */
export function monthDayOf(crDay: string): MonthDay {
  return crDay.slice(MD_START);
}

/** El día-mes cae en [start, end]; si start > end, la temporada cruza el fin de año. */
export function inSeason(md: MonthDay, start: MonthDay, end: MonthDay): boolean {
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

/** Día del año (1-366) en un año bisiesto de referencia. */
function dayOfYear(md: MonthDay): number {
  const [month, day] = md.split('-').map(Number);
  let total = day;
  for (let m = 1; m < month; m++) total += DAYS_IN_MONTH[m - 1];
  return total;
}

/** La temporada como uno o dos intervalos de día del año (la que cruza el año se parte). */
function intervals(start: MonthDay, end: MonthDay): [number, number][] {
  return start <= end
    ? [[dayOfYear(start), dayOfYear(end)]]
    : [
        [dayOfYear(start), dayOfYear(LAST_DAY)],
        [dayOfYear(FIRST_DAY), dayOfYear(end)],
      ];
}

export type Season = { start: MonthDay; end: MonthDay };

/** Dos temporadas comparten al menos un día del año. */
export function seasonsOverlap(a: Season, b: Season): boolean {
  return intervals(a.start, a.end).some(([a1, a2]) =>
    intervals(b.start, b.end).some(([b1, b2]) => a1 <= b2 && b1 <= a2),
  );
}

/** Las temporadas juntas cubren los 366 días del año de referencia. */
export function coversWholeYear(seasons: Season[]): boolean {
  const covered = new Set<number>();
  for (const s of seasons) {
    for (const [from, to] of intervals(s.start, s.end)) {
      for (let d = from; d <= to; d++) covered.add(d);
    }
  }
  return covered.size === YEAR_DAYS;
}

/** Una tarifa, con o sin temporada (las dos puntas nulas = precio base). */
export type PriceRow = {
  ticket_type: string;
  price_usd: number | string;
  season_start: MonthDay | null;
  season_end: MonthDay | null;
};

type SeasonRow = { season_start: MonthDay; season_end: MonthDay };

function isSeason<T extends PriceRow>(row: T): row is T & SeasonRow {
  return row.season_start !== null && row.season_end !== null;
}

/**
 * El precio de cada tiquete para un día de Costa Rica (spec 0040): la temporada que contiene el
 * día o, si no hay, el precio base (la temporada gana, regla del spec 0028). Recibe solo filas
 * activas. Sin superposición (la garantiza la base) hay a lo sumo una temporada por día y
 * tiquete; si aun así hubiera dos, gana la que empieza más tarde en el año, para que el monto no
 * dependa del orden de las filas.
 */
export function selectPriceForDay<T extends PriceRow>(rows: T[], crDay: string): T[] {
  const md = monthDayOf(crDay);
  const byType = new Map<string, T>();
  for (const row of rows) {
    const current = byType.get(row.ticket_type);
    if (isSeason(row)) {
      if (!inSeason(md, row.season_start, row.season_end)) continue;
      if (!current || !isSeason(current) || row.season_start > current.season_start) {
        byType.set(row.ticket_type, row);
      }
    } else if (!current) {
      byType.set(row.ticket_type, row);
    }
  }
  return [...byType.values()];
}

/**
 * El precio más bajo de un tiquete que se cobra en algún día del año: el base no cuenta si las
 * temporadas cubren todo el año, porque nunca se cobraría.
 */
export function lowestChargedPrice<T extends PriceRow>(
  rows: T[],
  ticketType: string,
): number | null {
  const ofType = rows.filter((r) => r.ticket_type === ticketType);
  const seasons = ofType.filter(isSeason);
  const base = ofType.filter((r) => !isSeason(r));
  const charged = coversWholeYear(
    seasons.map((r) => ({ start: r.season_start, end: r.season_end })),
  )
    ? seasons
    : [...seasons, ...base];
  if (charged.length === 0) return null;
  return Math.min(...charged.map((r) => Number(r.price_usd)));
}
