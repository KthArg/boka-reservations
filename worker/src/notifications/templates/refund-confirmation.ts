import type { EmailLocale, RenderedEmail } from '../types.js';
import { escapeHtml, formatMoney } from './format.js';
import { wrapHtml } from './layout.js';

export type RefundConfirmationProps = {
  customerName: string;
  tourName: string;
  refundAmountCents: number;
  currency: string;
  /** Devolución por transferencia o SINPE Móvil (spec 0035); null si fue a la tarjeta. */
  transferChannel: TransferChannel | null;
};

export type TransferChannel = 'sinpe_movil' | 'bank_transfer';

const COPY = {
  es: {
    subject: (tour: string) => `Tu reembolso fue procesado — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: (amount: string) =>
      `Procesamos tu reembolso de ${amount} por la cancelación de tu reserva.`,
    transferIntro: (amount: string, channel: string) =>
      `Te devolvimos ${amount} por ${channel}, por la cancelación de tu reserva.`,
    channel: { sinpe_movil: 'SINPE Móvil', bank_transfer: 'transferencia bancaria' },
    tourLabel: 'Tour',
    note: 'Según tu banco, puede tardar algunos días hábiles en reflejarse.',
    farewell: 'Esperamos verte en otra ocasión.',
  },
  en: {
    subject: (tour: string) => `Your refund was processed — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro: (amount: string) => `We processed your ${amount} refund for the cancelled booking.`,
    transferIntro: (amount: string, channel: string) =>
      `We refunded ${amount} by ${channel} for the cancelled booking.`,
    channel: { sinpe_movil: 'SINPE Móvil', bank_transfer: 'bank transfer' },
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
  const intro = props.transferChannel
    ? t.transferIntro(amount, t.channel[props.transferChannel])
    : t.intro(amount);

  const html = wrapHtml(`
    <h1 style="font-size:20px;margin:0 0 16px;">${t.greeting(escapeHtml(props.customerName))}</h1>
    <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="background:#fafafa;border-radius:6px;margin:0 0 24px;">
      <tr><td style="font-weight:600;">${t.tourLabel}</td><td>${escapeHtml(props.tourName)}</td></tr>
    </table>
    <p style="margin:0 0 24px;color:#555;">${t.note}</p>
    <p style="margin:0;color:#555;">${t.farewell}</p>
  `);

  const text = [
    t.greeting(props.customerName),
    '',
    intro,
    '',
    `${t.tourLabel}: ${props.tourName}`,
    '',
    t.note,
    '',
    t.farewell,
  ].join('\n');

  return { subject: t.subject(props.tourName), html, text };
}
