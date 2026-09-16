import type { EmailLocale, RenderedEmail } from '../types.js';
import { composeEmail } from './compose.js';
import { formatDateTime, formatMoney } from './format.js';

// "Reserva registrada" del cobro diferido (spec 0029 §4): el turista guardó la tarjeta y no se le
// cobró. Monto que se cobrará y últimos 4 dígitos de la tarjeta.

export type BookingReservedProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  totalAmountCents: number;
  currency: string;
  cardLast4: string;
  bookingUrl: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `Tu reserva está registrada — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: 'Registramos tu reserva y guardamos tu tarjeta. Todavía no te cobramos nada.',
    charge: (amount: string, last4: string) =>
      `Cuando la salida se confirme, cobraremos ${amount} a la tarjeta terminada en ${last4} y te enviaremos la confirmación.`,
    tourLabel: 'Tour',
    dateLabel: 'Fecha y hora',
    amountLabel: 'Monto a cobrar',
    cardLabel: 'Tarjeta',
    card: (last4: string) => `Terminada en ${last4}`,
    cta: 'Ver mi reserva',
    closing: 'Si cambiás de planes, podés cancelar la reserva sin costo antes del cobro.',
  },
  en: {
    subject: (tour: string) => `Your booking is registered — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro: "We registered your booking and saved your card. You haven't been charged yet.",
    charge: (amount: string, last4: string) =>
      `Once the departure is confirmed, we'll charge ${amount} to the card ending in ${last4} and send you the confirmation.`,
    tourLabel: 'Tour',
    dateLabel: 'Date and time',
    amountLabel: 'Amount to charge',
    cardLabel: 'Card',
    card: (last4: string) => `Ending in ${last4}`,
    cta: 'View my booking',
    closing: 'If your plans change, you can cancel the booking at no cost before the charge.',
  },
};

export function renderBookingReserved(
  props: BookingReservedProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const amount = formatMoney(props.totalAmountCents, props.currency, locale);

  return composeEmail({
    subject: t.subject(props.tourName),
    greeting: t.greeting(props.customerName),
    paragraphs: [t.intro, t.charge(amount, props.cardLast4)],
    rows: [
      [t.tourLabel, props.tourName],
      [t.dateLabel, formatDateTime(props.startsAt, locale)],
      [t.amountLabel, amount],
      [t.cardLabel, t.card(props.cardLast4)],
    ],
    cta: { label: t.cta, url: props.bookingUrl },
    closing: t.closing,
  });
}
