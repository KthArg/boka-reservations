import 'server-only';
import { BUSINESS_TIMEZONE, crDate } from '@/lib/dates/cr-date';
import {
  seatsLeft,
  type CalendarDeparture,
} from '@/components/public/AvailabilityCalendar/calendar';
import type { PublicInstance } from './tours';

/**
 * Salidas para el calendario del tour (spec 0039), preparadas en el servidor: el día de Costa Rica
 * y la hora ya formateada viajan como texto, así el HTML del servidor y el del navegador coinciden
 * y el navegador no recibe la fila completa de `tour_instances`.
 */
export function toCalendarDepartures(
  instances: PublicInstance[],
  locale: string,
): CalendarDeparture[] {
  const time = new Intl.DateTimeFormat(locale === 'es' ? 'es-CR' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: BUSINESS_TIMEZONE,
  });
  return instances.map((instance) => {
    const startsAt = new Date(instance.starts_at);
    return {
      id: instance.id,
      crDay: crDate(startsAt),
      time: time.format(startsAt),
      seatsLeft: seatsLeft(instance.capacity_total, instance.capacity_reserved),
    };
  });
}
