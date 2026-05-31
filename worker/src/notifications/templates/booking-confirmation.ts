import type { EmailLocale } from '../types.js';
import { escapeHtml, formatDateTime, formatMoney } from './format.js';
import { wrapHtml } from './layout.js';

export type BookingConfirmationProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  meetingPoint: string;
  ticketsAdult: number;
  ticketsChild: number;
  ticketsStudent: number;
  totalAmountCents: number;
  currency: string;
  bookingUrl: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const COPY = {
  es: {
    subject: (tour: string) => `Tu reserva está confirmada — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: 'Tu reserva quedó confirmada. Acá están los detalles:',
    tourLabel: 'Tour',
    dateLabel: 'Fecha y hora',
    meetingLabel: 'Punto de encuentro',
    ticketsLabel: 'Tickets',
    totalLabel: 'Total cobrado',
    cta: 'Ver mi reserva',
    farewell: 'Nos vemos pronto.',
    adult: (n: number) => `${n} adulto(s)`,
    child: (n: number) => `${n} niño(s)`,
    student: (n: number) => `${n} estudiante(s)`,
  },
  en: {
    subject: (tour: string) => `Your booking is confirmed — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro: 'Your booking is confirmed. Here are the details:',
    tourLabel: 'Tour',
    dateLabel: 'Date and time',
    meetingLabel: 'Meeting point',
    ticketsLabel: 'Tickets',
    totalLabel: 'Total charged',
    cta: 'View my booking',
    farewell: 'See you soon.',
    adult: (n: number) => `${n} adult(s)`,
    child: (n: number) => `${n} child(ren)`,
    student: (n: number) => `${n} student(s)`,
  },
};

function ticketsLine(props: BookingConfirmationProps, locale: EmailLocale): string {
  const t = COPY[locale];
  const parts: string[] = [];
  if (props.ticketsAdult > 0) parts.push(t.adult(props.ticketsAdult));
  if (props.ticketsChild > 0) parts.push(t.child(props.ticketsChild));
  if (props.ticketsStudent > 0) parts.push(t.student(props.ticketsStudent));
  return parts.join(', ');
}

export function renderBookingConfirmation(
  props: BookingConfirmationProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const tickets = ticketsLine(props, locale);
  const date = formatDateTime(props.startsAt, locale);
  const total = formatMoney(props.totalAmountCents, props.currency, locale);

  const html = wrapHtml(`
    <h1 style="font-size:20px;margin:0 0 16px;">${t.greeting(escapeHtml(props.customerName))}</h1>
    <p style="margin:0 0 16px;">${t.intro}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="background:#fafafa;border-radius:6px;margin:0 0 24px;">
      <tr><td style="font-weight:600;">${t.tourLabel}</td><td>${escapeHtml(props.tourName)}</td></tr>
      <tr><td style="font-weight:600;">${t.dateLabel}</td><td>${escapeHtml(date)}</td></tr>
      <tr><td style="font-weight:600;">${t.meetingLabel}</td><td>${escapeHtml(props.meetingPoint)}</td></tr>
      <tr><td style="font-weight:600;">${t.ticketsLabel}</td><td>${escapeHtml(tickets)}</td></tr>
      <tr><td style="font-weight:600;">${t.totalLabel}</td><td>${escapeHtml(total)}</td></tr>
    </table>
    <p style="margin:0 0 24px;">
      <a href="${escapeHtml(props.bookingUrl)}" style="display:inline-block;background:#1d9e75;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;">${t.cta}</a>
    </p>
    <p style="margin:0;color:#555;">${t.farewell}</p>
  `);

  const text = [
    t.greeting(props.customerName),
    '',
    t.intro,
    '',
    `${t.tourLabel}: ${props.tourName}`,
    `${t.dateLabel}: ${date}`,
    `${t.meetingLabel}: ${props.meetingPoint}`,
    `${t.ticketsLabel}: ${tickets}`,
    `${t.totalLabel}: ${total}`,
    '',
    `${t.cta}: ${props.bookingUrl}`,
    '',
    t.farewell,
  ].join('\n');

  return { subject: t.subject(props.tourName), html, text };
}
