import type { EmailLocale, RenderedEmail } from '../types.js';
import { escapeHtml, formatMoney } from './format.js';
import { wrapHtml } from './layout.js';

export type RefundConfirmationProps = {
  customerName: string;
  tourName: string;
  refundAmountCents: number;
  currency: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `Tu reembolso fue procesado — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: (amount: string) =>
      `Procesamos tu reembolso de ${amount} por la cancelación de tu reserva.`,
    tourLabel: 'Tour',
    note: 'Según tu banco, puede tardar algunos días hábiles en reflejarse.',
    farewell: 'Esperamos verte en otra ocasión.',
  },
  en: {
    subject: (tour: string) => `Your refund was processed — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro: (amount: string) => `We processed your ${amount} refund for the cancelled booking.`,
    tourLabel: 'Tour',
    note: 'Depending on your bank, it may take a few business days to appear.',
    farewell: 'We hope to see you another time.',
  },
};

export function renderRefundConfirmation(
  props: RefundConfirmationProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const amount = formatMoney(props.refundAmountCents, props.currency, locale);

  const html = wrapHtml(`
    <h1 style="font-size:20px;margin:0 0 16px;">${t.greeting(escapeHtml(props.customerName))}</h1>
    <p style="margin:0 0 16px;">${escapeHtml(t.intro(amount))}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="background:#fafafa;border-radius:6px;margin:0 0 24px;">
      <tr><td style="font-weight:600;">${t.tourLabel}</td><td>${escapeHtml(props.tourName)}</td></tr>
    </table>
    <p style="margin:0 0 24px;color:#555;">${t.note}</p>
    <p style="margin:0;color:#555;">${t.farewell}</p>
  `);

  const text = [
    t.greeting(props.customerName),
    '',
    t.intro(amount),
    '',
    `${t.tourLabel}: ${props.tourName}`,
    '',
    t.note,
    '',
    t.farewell,
  ].join('\n');

  return { subject: t.subject(props.tourName), html, text };
}
