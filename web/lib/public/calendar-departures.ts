import 'server-only';
import { BUSINESS_TIMEZONE, crDate } from '@/lib/dates/cr-date';
import { formatMoneyCents, intlLocaleTag } from '@/lib/format/money';
import { selectPriceForDay, type PriceRow } from '@/lib/pricing/season';
import { CENTS_PER_UNIT } from '@shared/constants/bookings';
import { TicketType } from '@shared/constants/enums';
import { seatsLeft, type CalendarDeparture } from './calendar';
import type { PublicInstance } from './tours';

/**
 * Salidas para el calendario del tour (spec 0039), preparadas en el servidor: el día de Costa Rica
 * y la hora ya formateada viajan como texto, así el HTML del servidor y el del navegador coinciden
 * y el navegador no recibe la fila completa de `tour_instances`.
 */
export function toCalendarDepartures(
  instances: PublicInstance[],
  locale: string,
  pricing: PriceRow[] = [],
): CalendarDeparture[] {
  const time = new Intl.DateTimeFormat(intlLocaleTag(locale), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: BUSINESS_TIMEZONE,
  });
  return instances.map((instance) => {
    const startsAt = new Date(instance.starts_at);
    const crDay = crDate(startsAt);
    const adult = selectPriceForDay(pricing, crDay).find((p) => p.ticket_type === TicketType.Adult);
    return {
      id: instance.id,
      crDay,
      time: time.format(startsAt),
      seatsLeft: seatsLeft(instance.capacity_total, instance.capacity_reserved),
      adultPrice: adult
        ? formatMoneyCents(Math.round(Number(adult.price_usd) * CENTS_PER_UNIT), 'USD', locale)
        : null,
    };
  });
}
