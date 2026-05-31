import { OPERATOR_UTC_OFFSET_HOURS } from '@shared/constants/bookings';

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/**
 * Límites en UTC del "día en curso" según la zona horaria del operador.
 * Costa Rica es UTC-6 sin DST, así que la medianoche local equivale a
 * medianoche local + 6h en UTC. Se devuelve [start, end) en ISO para
 * filtrar `starts_at` de las instancias del día.
 */
export function operatorDayBoundsUtc(now: Date = new Date()): { startIso: string; endIso: string } {
  const offsetMs = OPERATOR_UTC_OFFSET_HOURS * MS_PER_HOUR;
  // Llevamos "ahora" a hora local del operador para leer su fecha calendario.
  const local = new Date(now.getTime() + offsetMs);
  const localMidnightUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  // La medianoche local, expresada en UTC, está desplazada -offset.
  const startMs = localMidnightUtc - offsetMs;
  const endMs = startMs + HOURS_PER_DAY * MS_PER_HOUR;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Formatea un timestamp ISO a fecha y hora en la zona del operador (UTC-6).
 * Devuelve cadenas vacías si el ISO es vacío o inválido.
 */
export function formatOperatorDateTime(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return { date: '', time: '' };
  const local = new Date(ms + OPERATOR_UTC_OFFSET_HOURS * MS_PER_HOUR);
  const date = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;
  const time = `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;
  return { date, time };
}
