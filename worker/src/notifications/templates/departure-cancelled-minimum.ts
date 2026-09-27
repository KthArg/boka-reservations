import type { EmailLocale, RenderedEmail } from '../types.js';
import { escapeHtml, formatDateTime } from './format.js';
import { wrapHtml } from './layout.js';

export type DepartureCancelledMinimumProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  /**
   * Hubo una autorización con captura manual sobre la tarjeta (spec 0033 §5.12): se soltó sin
   * capturar, pero la retención puede seguir viéndose unos días. El texto nunca afirma que la
   * hubo; solo suma la aclaración cuando la hubo.
   */
  hadAuthorization: boolean;
  toursUrl: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `La salida fue cancelada — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: 'La salida no alcanzó el mínimo de participantes, así que tuvimos que cancelarla.',
    tourLabel: 'Tour',
    dateLabel: 'Fecha y hora',
    noCharge: 'No se hizo ningún cobro a tu tarjeta.',
    hold: 'Si viste una retención temporal en tu estado de cuenta, ya la liberamos: puede tardar unos días hábiles en desaparecer.',
    cta: 'Ver otras fechas',
    farewell: 'Lamentamos el inconveniente. Ojalá puedas acompañarnos en otra fecha.',
  },
  en: {
    subject: (tour: string) => `The departure was cancelled — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro:
      'This departure did not reach the minimum number of participants, so we had to cancel it.',
    tourLabel: 'Tour',
    dateLabel: 'Date and time',
    noCharge: 'Your card was not charged.',
    hold: 'If you saw a temporary hold on your statement, we already released it: it can take a few business days to disappear.',
    cta: 'See other dates',
    farewell: 'Sorry for the inconvenience. We hope you can join us on another date.',
  },
};

export function renderDepartureCancelledMinimum(
  props: DepartureCancelledMinimumProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const date = formatDateTime(props.startsAt, locale);
  const holdHtml = props.hadAuthorization ? `<p style="margin:0 0 24px;">${t.hold}</p>` : '';

  const html = wrapHtml(`
    <h1 style="font-size:20px;margin:0 0 16px;">${t.greeting(escapeHtml(props.customerName))}</h1>
    <p style="margin:0 0 16px;">${t.intro}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="background:#fafafa;border-radius:6px;margin:0 0 24px;">
      <tr><td style="font-weight:600;">${t.tourLabel}</td><td>${escapeHtml(props.tourName)}</td></tr>
      <tr><td style="font-weight:600;">${t.dateLabel}</td><td>${escapeHtml(date)}</td></tr>
    </table>
    <p style="margin:0 0 16px;">${t.noCharge}</p>
    ${holdHtml}
    <p style="margin:0 0 24px;">
      <a href="${escapeHtml(props.toursUrl)}" style="display:inline-block;background:#1d9e75;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;">${t.cta}</a>
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
    '',
    t.noCharge,
    ...(props.hadAuthorization ? [t.hold] : []),
    '',
    `${t.cta}: ${props.toursUrl}`,
    '',
    t.farewell,
  ].join('\n');

  return { subject: t.subject(props.tourName), html, text };
}
