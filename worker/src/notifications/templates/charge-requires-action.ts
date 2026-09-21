import type { EmailLocale, RenderedEmail } from '../types.js';
import { composeEmail } from './compose.js';
import { formatDateTime, formatMoney } from './format.js';

// Aviso de autenticación 3DS (spec 0029 §5.7): el banco pidió confirmar el cobro. Enlace a la
// página de autenticación, válido hasta awaiting_action_until.

export type ChargeRequiresActionProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  totalAmountCents: number;
  currency: string;
  deadline: string;
  authenticateUrl: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `Tu banco pide confirmar el cobro — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: (amount: string) =>
      `Para completar el cobro de ${amount} de tu reserva, tu banco necesita que confirmes la operación.`,
    deadline: (deadline: string) => `Tenés hasta el ${deadline}.`,
    tourLabel: 'Tour',
    dateLabel: 'Fecha y hora',
    amountLabel: 'Monto',
    cta: 'Confirmar el pago',
    closing: 'Si no lo confirmás a tiempo, la reserva se cancela sin ningún cobro.',
  },
  en: {
    subject: (tour: string) => `Your bank needs you to confirm the charge — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro: (amount: string) =>
      `To complete the charge of ${amount} for your booking, your bank needs you to confirm it.`,
    deadline: (deadline: string) => `You have until ${deadline}.`,
    tourLabel: 'Tour',
    dateLabel: 'Date and time',
    amountLabel: 'Amount',
    cta: 'Confirm the payment',
    closing: "If it isn't confirmed in time, the booking is cancelled with no charge.",
  },
};

export function renderChargeRequiresAction(
  props: ChargeRequiresActionProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const amount = formatMoney(props.totalAmountCents, props.currency, locale);

  return composeEmail({
    subject: t.subject(props.tourName),
    greeting: t.greeting(props.customerName),
    paragraphs: [t.intro(amount), t.deadline(formatDateTime(props.deadline, locale))],
    rows: [
      [t.tourLabel, props.tourName],
      [t.dateLabel, formatDateTime(props.startsAt, locale)],
      [t.amountLabel, amount],
    ],
    cta: { label: t.cta, url: props.authenticateUrl },
    closing: t.closing,
  });
}
