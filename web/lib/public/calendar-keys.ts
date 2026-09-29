/**
 * Claves de i18n de meses (1-12) y días de la semana ISO (1-7), escritas completas para que el
 * compilador valide que existen en los archivos de idioma.
 */
export const MONTH_KEYS = [
  'calendar-month-1',
  'calendar-month-2',
  'calendar-month-3',
  'calendar-month-4',
  'calendar-month-5',
  'calendar-month-6',
  'calendar-month-7',
  'calendar-month-8',
  'calendar-month-9',
  'calendar-month-10',
  'calendar-month-11',
  'calendar-month-12',
] as const;

export const WEEKDAY_SHORT_KEYS = [
  'calendar-weekday-short-1',
  'calendar-weekday-short-2',
  'calendar-weekday-short-3',
  'calendar-weekday-short-4',
  'calendar-weekday-short-5',
  'calendar-weekday-short-6',
  'calendar-weekday-short-7',
] as const;

export const WEEKDAY_LONG_KEYS = [
  'calendar-weekday-long-1',
  'calendar-weekday-long-2',
  'calendar-weekday-long-3',
  'calendar-weekday-long-4',
  'calendar-weekday-long-5',
  'calendar-weekday-long-6',
  'calendar-weekday-long-7',
] as const;
