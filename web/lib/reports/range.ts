import { EXPORT_MAX_RANGE_DAYS } from '@shared/constants/bookings';
import { ReportRangeError } from '@shared/constants/reports';

// Costa Rica no tiene horario de verano: siempre UTC-6.
const CR_UTC_OFFSET = '-06:00';
const MS_PER_DAY = 86_400_000;
const ISO_DATE_LEN = 10; // 'YYYY-MM-DD'

/** Rango como lo maneja la UI: dos fechas 'YYYY-MM-DD' (inclusivas). */
export type ReportRange = { from: string; to: string };

/** Límites timestamptz medio-abiertos [fromIso, toIso) que reciben las RPC. */
export type ReportRangeBounds = { fromIso: string; toIso: string };

/** Fecha 'YYYY-MM-DD' de un instante, en horario de Costa Rica. */
function crDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' });
}

/** Rango por defecto: del primer día del mes en curso a hoy (hora CR). */
export function defaultReportRange(now: Date = new Date()): ReportRange {
  const today = crDate(now);
  return { from: `${today.slice(0, ISO_DATE_LEN - 2)}01`, to: today };
}

/** Valida el rango: ambas fechas presentes, no invertido, y ≤ 1 año. */
export function validateReportRange(from?: string, to?: string): ReportRangeError | null {
  if (!from || !to) return ReportRangeError.Missing;
  const f = Date.parse(`${from}T00:00:00${CR_UTC_OFFSET}`);
  const t = Date.parse(`${to}T00:00:00${CR_UTC_OFFSET}`);
  if (Number.isNaN(f) || Number.isNaN(t)) return ReportRangeError.Missing;
  if (t < f) return ReportRangeError.Inverted;
  if ((t - f) / MS_PER_DAY > EXPORT_MAX_RANGE_DAYS) return ReportRangeError.TooLong;
  return null;
}

/**
 * Convierte el rango inclusivo (días en hora CR) a límites medio-abiertos
 * [fromIso, toIso): fromIso = inicio del día "desde"; toIso = inicio del día
 * siguiente al "hasta", para que el día "hasta" quede incluido.
 */
export function toRangeBounds({ from, to }: ReportRange): ReportRangeBounds {
  const fromIso = new Date(`${from}T00:00:00${CR_UTC_OFFSET}`).toISOString();
  const toDate = new Date(`${to}T00:00:00${CR_UTC_OFFSET}`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  return { fromIso, toIso: toDate.toISOString() };
}
