import type { EmailLocale, RenderedEmail } from '../types.js';
import { composeEmail } from './compose.js';
import { formatMoney } from './format.js';

// Pedido de datos para devolver por transferencia o SINPE Móvil (spec 0035; términos, cláusula
// 8): la tarjeta no aceptó el reembolso. El turista responde este correo, que llega al correo de
// contacto del operador (Reply-To); la plataforma no guarda los datos de la cuenta.

export type RefundTransferRequestProps = {
  customerName: string;
  tourName: string;
  amountCents: number;
  currency: string;
  bookingUrl: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `Necesitamos tus datos para devolverte el dinero — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    intro: (amount: string) =>
      `Tu banco no aceptó el reembolso de ${amount} a la tarjeta con la que pagaste, así que te lo vamos a devolver por transferencia bancaria o SINPE Móvil.`,
    ask: 'Respondé este correo con los datos de una cuenta a nombre de la persona que hizo la reserva: nombre completo, número de identificación, y la cuenta IBAN o el número de SINPE Móvil.',
    tourLabel: 'Tour',
    amountLabel: 'Monto a devolver',
    cta: 'Ver mi reserva',
    closing: 'Apenas hagamos la transferencia te enviamos la confirmación.',
  },
  en: {
    subject: (tour: string) => `We need your details to refund you — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    intro: (amount: string) =>
      `Your bank did not accept the ${amount} refund to the card you paid with, so we will refund you by bank transfer or SINPE Móvil.`,
    ask: 'Reply to this email with the details of an account in the name of the person who made the booking: full name, ID number, and the IBAN account or SINPE Móvil number.',
    tourLabel: 'Tour',
    amountLabel: 'Amount to refund',
    cta: 'View my booking',
    closing: 'As soon as we make the transfer we will send you the confirmation.',
  },
};

export function renderRefundTransferRequest(
  props: RefundTransferRequestProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  const amount = formatMoney(props.amountCents, props.currency, locale);
  return composeEmail({
    subject: t.subject(props.tourName),
    greeting: t.greeting(props.customerName),
    paragraphs: [t.intro(amount), t.ask],
    rows: [
      [t.tourLabel, props.tourName],
      [t.amountLabel, amount],
    ],
    cta: { label: t.cta, url: props.bookingUrl },
    closing: t.closing,
  });
}
