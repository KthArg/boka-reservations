import type { EmailLocale, RenderedEmail } from '../types.js';
import { escapeHtml, formatDateTime, formatMoney } from './format.js';
import { wrapHtml } from './layout.js';

export type OverbookedRefundedProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  refundAmountCents: number;
  currency: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `Lo sentimos: el cupo se agotó — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro:
      'Lamentablemente el cupo de este tour se agotó justo cuando se procesó tu pago, así que no pudimos confirmar tu reserva.',
    tourLabel: 'Tour',
    dateLabel: 'Fecha y hora',
    refund: (amount: string) =>
      `Ya iniciamos el reembolso total de ${amount}. Lo vas a ver acreditado en los próximos días hábiles, según tu banco.`,
    farewell: 'Lamentamos el inconveniente y esperamos recibirte en otra salida.',
  },
  en: {
    subject: (tour: string) => `Sorry, the tour sold out — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro:
      'Unfortunately this tour sold out right as your payment was processed, so we could not confirm your booking.',
    tourLabel: 'Tour',
    dateLabel: 'Date and time',
    refund: (amount: string) =>
      `We have already started a full ${amount} refund. You should see it credited within the next business days, depending on your bank.`,
    farewell: 'We are sorry for the inconvenience and hope to host you on another departure.',
  },
};

export function renderOverbookedRefunded(
  props: OverbookedRefundedProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const date = formatDateTime(props.startsAt, locale);
  const refundLine = t.refund(formatMoney(props.refundAmountCents, props.currency, locale));

  const html = wrapHtml(`
    <h1 style="font-size:20px;margin:0 0 16px;">${t.greeting(escapeHtml(props.customerName))}</h1>
    <p style="margin:0 0 16px;">${escapeHtml(t.intro)}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="background:#fafafa;border-radius:6px;margin:0 0 24px;">
      <tr><td style="font-weight:600;">${t.tourLabel}</td><td>${escapeHtml(props.tourName)}</td></tr>
      <tr><td style="font-weight:600;">${t.dateLabel}</td><td>${escapeHtml(date)}</td></tr>
    </table>
    <p style="margin:0 0 24px;">${escapeHtml(refundLine)}</p>
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
    t.farewell,
  ].join('\n');

  return { subject: t.subject(props.tourName), html, text };
}
