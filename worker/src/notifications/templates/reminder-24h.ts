import type { EmailLocale } from '../types.js';
import type { RenderedEmail } from './booking-confirmation.js';
import { escapeHtml, formatDateTime } from './format.js';
import { wrapHtml } from './layout.js';

export type Reminder24hProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  meetingPoint: string;
  bookingUrl: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `Tu tour es mañana — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: 'Te recordamos que tu tour es mañana. Acá los datos:',
    tourLabel: 'Tour',
    dateLabel: 'Fecha y hora',
    meetingLabel: 'Punto de encuentro',
    cta: 'Ver detalles de mi reserva',
    bring: 'Recordá traer ropa cómoda, calzado adecuado, agua y protector solar.',
    farewell: '¡Nos vemos mañana!',
  },
  en: {
    subject: (tour: string) => `Your tour is tomorrow — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro: 'Just a reminder that your tour is tomorrow. Quick rundown:',
    tourLabel: 'Tour',
    dateLabel: 'Date and time',
    meetingLabel: 'Meeting point',
    cta: 'View my booking',
    bring: 'Bring comfortable clothes, proper shoes, water, and sunscreen.',
    farewell: 'See you tomorrow!',
  },
};

export function renderReminder24h(props: Reminder24hProps, locale: EmailLocale): RenderedEmail {
  const t = COPY[locale];
  const date = formatDateTime(props.startsAt, locale);

  const html = wrapHtml(`
    <h1 style="font-size:20px;margin:0 0 16px;">${t.greeting(escapeHtml(props.customerName))}</h1>
    <p style="margin:0 0 16px;">${t.intro}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="background:#fafafa;border-radius:6px;margin:0 0 24px;">
      <tr><td style="font-weight:600;">${t.tourLabel}</td><td>${escapeHtml(props.tourName)}</td></tr>
      <tr><td style="font-weight:600;">${t.dateLabel}</td><td>${escapeHtml(date)}</td></tr>
      <tr><td style="font-weight:600;">${t.meetingLabel}</td><td>${escapeHtml(props.meetingPoint)}</td></tr>
    </table>
    <p style="margin:0 0 24px;color:#555;">${t.bring}</p>
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
    '',
    t.bring,
    '',
    `${t.cta}: ${props.bookingUrl}`,
    '',
    t.farewell,
  ].join('\n');

  return { subject: t.subject(props.tourName), html, text };
}
