import type { EmailLocale, RenderedEmail } from '../types.js';
import { escapeHtml, formatDateTime } from './format.js';
import { wrapHtml } from './layout.js';

export type GuideAssignmentProps = {
  guideName: string;
  tourName: string;
  startsAt: string;
  meetingPoint: string;
  passengerCount: number;
  upcomingUrl: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `Te asignaron una salida — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: 'Te asignamos como guía de la siguiente salida:',
    tourLabel: 'Tour',
    dateLabel: 'Fecha y hora',
    meetingLabel: 'Punto de encuentro',
    passengersLabel: 'Pasajeros',
    passengers: (n: number) => `${n} confirmado(s)`,
    cta: 'Ver mis próximas salidas',
    farewell: '¡Gracias por guiar con Boka Verde!',
  },
  en: {
    subject: (tour: string) => `You were assigned a tour — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro: 'You have been assigned as the guide for the following tour:',
    tourLabel: 'Tour',
    dateLabel: 'Date and time',
    meetingLabel: 'Meeting point',
    passengersLabel: 'Passengers',
    passengers: (n: number) => `${n} confirmed`,
    cta: 'View my upcoming tours',
    farewell: 'Thanks for guiding with Boka Verde!',
  },
};

export function renderGuideAssignment(
  props: GuideAssignmentProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const date = formatDateTime(props.startsAt, locale);

  const html = wrapHtml(`
    <h1 style="font-size:20px;margin:0 0 16px;">${t.greeting(escapeHtml(props.guideName))}</h1>
    <p style="margin:0 0 16px;">${t.intro}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="background:#fafafa;border-radius:6px;margin:0 0 24px;">
      <tr><td style="font-weight:600;">${t.tourLabel}</td><td>${escapeHtml(props.tourName)}</td></tr>
      <tr><td style="font-weight:600;">${t.dateLabel}</td><td>${escapeHtml(date)}</td></tr>
      <tr><td style="font-weight:600;">${t.meetingLabel}</td><td>${escapeHtml(props.meetingPoint)}</td></tr>
      <tr><td style="font-weight:600;">${t.passengersLabel}</td><td>${escapeHtml(t.passengers(props.passengerCount))}</td></tr>
    </table>
    <p style="margin:0 0 24px;">
      <a href="${escapeHtml(props.upcomingUrl)}" style="display:inline-block;background:#1d9e75;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;">${t.cta}</a>
    </p>
    <p style="margin:0;color:#555;">${t.farewell}</p>
  `);

  const text = [
    t.greeting(props.guideName),
    '',
    t.intro,
    '',
    `${t.tourLabel}: ${props.tourName}`,
    `${t.dateLabel}: ${date}`,
    `${t.meetingLabel}: ${props.meetingPoint}`,
    `${t.passengersLabel}: ${t.passengers(props.passengerCount)}`,
    '',
    `${t.cta}: ${props.upcomingUrl}`,
    '',
    t.farewell,
  ].join('\n');

  return { subject: t.subject(props.tourName), html, text };
}
