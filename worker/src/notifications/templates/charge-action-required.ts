import type { EmailLocale, RenderedEmail } from '../types.js';
import { composeEmail } from './compose.js';
import { formatDateTime, formatMoney } from './format.js';

// Aviso de tarjeta rechazada (spec 0029 §5.7): una plantilla para charge_failed_action_required_1,
// _2 y _3. Enlace para actualizar la tarjeta, válido hasta el plazo de recuperación.

export type ChargeActionRequiredProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  totalAmountCents: number;
  currency: string;
  cardLast4: string;
  deadline: string;
  updateUrl: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `No pudimos cobrar tu reserva — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    declined: (amount: string, last4: string) =>
      `El banco rechazó el cobro de ${amount} a la tarjeta terminada en ${last4}.`,
    held: (deadline: string) =>
      `Tu reserva sigue guardada hasta el ${deadline}. Actualizá la tarjeta antes de esa fecha para que podamos cobrarla.`,
    tourLabel: 'Tour',
    dateLabel: 'Fecha y hora',
    amountLabel: 'Monto',
    cta: 'Actualizar la tarjeta',
    closing: 'Si no la actualizás a tiempo, la reserva se cancela sin ningún cobro.',
  },
  en: {
    subject: (tour: string) => `We couldn't charge your booking — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    declined: (amount: string, last4: string) =>
      `The bank declined the charge of ${amount} to the card ending in ${last4}.`,
    held: (deadline: string) =>
      `Your booking is held until ${deadline}. Update your card before then so we can charge it.`,
    tourLabel: 'Tour',
    dateLabel: 'Date and time',
    amountLabel: 'Amount',
    cta: 'Update my card',
    closing: "If it isn't updated in time, the booking is cancelled with no charge.",
  },
};

export function renderChargeActionRequired(
  props: ChargeActionRequiredProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const amount = formatMoney(props.totalAmountCents, props.currency, locale);

  return composeEmail({
    subject: t.subject(props.tourName),
    greeting: t.greeting(props.customerName),
    paragraphs: [
      t.declined(amount, props.cardLast4),
      t.held(formatDateTime(props.deadline, locale)),
    ],
    rows: [
      [t.tourLabel, props.tourName],
      [t.dateLabel, formatDateTime(props.startsAt, locale)],
      [t.amountLabel, amount],
    ],
    cta: { label: t.cta, url: props.updateUrl },
    closing: t.closing,
  });
}
