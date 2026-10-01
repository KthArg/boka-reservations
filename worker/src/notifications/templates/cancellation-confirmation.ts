import type { EmailLocale, RenderedEmail } from '../types.js';
import { escapeHtml, formatDateTime, formatMoney } from './format.js';
import { wrapHtml } from './layout.js';
import { EmailStyle } from './styles.js';

export type CancellationConfirmationProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  hasRefund: boolean;
  refundAmountCents: number;
  currency: string;
  /** Reserva del cobro diferido que nunca se cobró (spec 0029 §5.8): no hay nada que reembolsar. */
  noCharge: boolean;
  /**
   * La salida se canceló por clima, seguridad o fuerza mayor y el equipo la cerró sin reembolso
   * (spec 0035; términos, cláusula 7). No es la política de cancelación del turista.
   */
  reviewClosed: boolean;
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
    reviewClosed:
      'Revisamos tu reserva después de cancelar la salida y, como prevén los términos para el clima, la seguridad y la fuerza mayor, se cierra sin reembolso.',
    noCharge: 'No se hizo ningún cobro a tu tarjeta, así que no hay nada que reembolsar.',
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
    reviewClosed:
      'We reviewed your booking after cancelling the departure and, as the terms provide for weather, safety and force majeure, it is closed with no refund.',
    noCharge: 'Your card was never charged, so there is nothing to refund.',
    cta: 'View my booking',
    farewell: 'Thanks for letting us know.',
  },
};

function refundLineFor(props: CancellationConfirmationProps, locale: EmailLocale): string {
  const t = COPY[locale];
  if (!props.hasRefund) {
    if (props.reviewClosed) return t.reviewClosed;
    return props.noCharge ? t.noCharge : t.noRefund;
  }
  return t.refund(formatMoney(props.refundAmountCents, props.currency, locale));
}

export function renderCancellationConfirmation(
  props: CancellationConfirmationProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const date = formatDateTime(props.startsAt, locale);
  const refundLine = refundLineFor(props, locale);

  const html = wrapHtml(`
    <h1 style="${EmailStyle.h1}">${t.greeting(escapeHtml(props.customerName))}</h1>
    <p style="margin:0 0 16px;">${t.intro}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="${EmailStyle.detailTable}">
      <tr><td style="font-weight:600;">${t.tourLabel}</td><td>${escapeHtml(props.tourName)}</td></tr>
      <tr><td style="font-weight:600;">${t.dateLabel}</td><td>${escapeHtml(date)}</td></tr>
    </table>
    <p style="margin:0 0 24px;">${escapeHtml(refundLine)}</p>
    <p style="margin:0 0 24px;">
      <a href="${escapeHtml(props.bookingUrl)}" style="${EmailStyle.button}">${t.cta}</a>
    </p>
    <p style="margin:0;color:${EmailStyle.muted};">${t.farewell}</p>
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
