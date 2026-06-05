import type { EmailLocale, RenderedEmail } from '../types.js';
import { escapeHtml, formatDateTime, formatMoney } from './format.js';
import { wrapHtml } from './layout.js';

export type CancellationConfirmationProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  hasRefund: boolean;
  refundAmountCents: number;
  currency: string;
  bookingUrl: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `Tu reserva fue cancelada — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: 'Confirmamos que tu reserva fue cancelada.',
    tourLabel: 'Tour',
    dateLabel: 'Fecha y hora',
    refund: (amount: string) =>
      `Te reembolsaremos ${amount}. Lo vas a ver acreditado en los próximos días hábiles.`,
    noRefund: 'Según la política de cancelación, esta cancelación no tiene reembolso.',
    cta: 'Ver mi reserva',
    farewell: 'Gracias por avisarnos.',
  },
  en: {
    subject: (tour: string) => `Your booking was cancelled — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro: 'We confirm your booking was cancelled.',
    tourLabel: 'Tour',
    dateLabel: 'Date and time',
    refund: (amount: string) =>
      `We will refund ${amount}. You should see it credited within the next business days.`,
    noRefund: 'Per the cancellation policy, this cancellation has no refund.',
    cta: 'View my booking',
    farewell: 'Thanks for letting us know.',
  },
};

export function renderCancellationConfirmation(
  props: CancellationConfirmationProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const date = formatDateTime(props.startsAt, locale);
  const refundLine = props.hasRefund
    ? t.refund(formatMoney(props.refundAmountCents, props.currency, locale))
    : t.noRefund;

  const html = wrapHtml(`
    <h1 style="font-size:20px;margin:0 0 16px;">${t.greeting(escapeHtml(props.customerName))}</h1>
    <p style="margin:0 0 16px;">${t.intro}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="background:#fafafa;border-radius:6px;margin:0 0 24px;">
      <tr><td style="font-weight:600;">${t.tourLabel}</td><td>${escapeHtml(props.tourName)}</td></tr>
      <tr><td style="font-weight:600;">${t.dateLabel}</td><td>${escapeHtml(date)}</td></tr>
    </table>
    <p style="margin:0 0 24px;">${escapeHtml(refundLine)}</p>
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
    '',
    refundLine,
    '',
    `${t.cta}: ${props.bookingUrl}`,
    '',
    t.farewell,
  ].join('\n');

  return { subject: t.subject(props.tourName), html, text };
}
