import type { EmailLocale, RenderedEmail } from '../types.js';
import { composeEmail } from './compose.js';
import { formatDateTime } from './format.js';

// Aviso de cambio de fecha (spec 0035): la reserva pasó a otra salida del mismo tour. El monto
// pagado no cambia.

export type BookingRescheduledProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  meetingPoint: string;
  bookingUrl: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `Cambiamos la fecha de tu reserva — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: 'Tu reserva pasó a una nueva fecha. Lo que pagaste no cambia.',
    tourLabel: 'Tour',
    dateLabel: 'Nueva fecha y hora',
    meetingLabel: 'Punto de encuentro',
    cta: 'Ver mi reserva',
    closing: 'Te esperamos.',
  },
  en: {
    subject: (tour: string) => `We changed the date of your booking — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro: 'Your booking moved to a new date. What you paid does not change.',
    tourLabel: 'Tour',
    dateLabel: 'New date and time',
    meetingLabel: 'Meeting point',
    cta: 'View my booking',
    closing: 'See you there.',
  },
};

export function renderBookingRescheduled(
  props: BookingRescheduledProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  return composeEmail({
    subject: t.subject(props.tourName),
    greeting: t.greeting(props.customerName),
    paragraphs: [t.intro],
    rows: [
      [t.tourLabel, props.tourName],
      [t.dateLabel, formatDateTime(props.startsAt, locale)],
      [t.meetingLabel, props.meetingPoint],
    ],
    cta: { label: t.cta, url: props.bookingUrl },
    closing: t.closing,
  });
}
