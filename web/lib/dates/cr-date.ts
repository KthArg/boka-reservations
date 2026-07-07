// Única fuente del "día del negocio" (spec 0028, B4): el día calendario de Costa Rica.
// Antes convivían tres semánticas de "día" en el panel (UTC en filtros/export, UTC-6 en
// "hoy", America/Costa_Rica en reportes) y todo tour entre 18:00 y 23:59 CR caía en el
// día equivocado del export contable.

export const BUSINESS_TIMEZONE = 'America/Costa_Rica';
// Costa Rica no tiene horario de verano: siempre UTC-6.
export const CR_UTC_OFFSET = '-06:00';

/** Fecha 'YYYY-MM-DD' de un instante, en el día calendario de Costa Rica. */
export function crDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE });
}

/** Inicio del día CR ('YYYY-MM-DD') como ISO UTC — límite inferior inclusivo. */
export function crDayStartIso(day: string): string {
  return new Date(`${day}T00:00:00${CR_UTC_OFFSET}`).toISOString();
}

/** Inicio del día CR SIGUIENTE como ISO UTC — límite superior exclusivo ([from, to)). */
export function crNextDayStartIso(day: string): string {
  const d = new Date(`${day}T00:00:00${CR_UTC_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
