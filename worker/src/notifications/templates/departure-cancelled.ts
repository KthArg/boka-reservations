import type { EmailLocale, RenderedEmail } from '../types.js';
import { composeEmail } from './compose.js';
import { formatDateTime, formatMoney } from './format.js';

// Aviso de salida cancelada por el operador (spec 0035). Nombra el motivo y dice qué pasa con la
// plata: reembolso del 100 %, reserva en revisión (clima o seguridad) o nada que devolver.

export type DepartureReason = 'minimum' | 'weather' | 'safety' | 'other';

export type DepartureOutcome =
  | { kind: 'refund'; amountCents: number; currency: string }
  | { kind: 'review' }
  | { kind: 'no_charge' };

export type DepartureCancelledProps = {
  customerName: string;
  tourName: string;
  startsAt: string;
  reason: DepartureReason;
  outcome: DepartureOutcome;
  toursUrl: string;
};

const COPY = {
  es: {
    subject: (tour: string) => `Cancelamos la salida — ${tour}`,
    greeting: (name: string) => `Hola ${name},`,
    reason: {
      minimum: 'La salida no alcanzó el mínimo de participantes, así que tuvimos que cancelarla.',
      weather: 'Tuvimos que cancelar la salida por las condiciones del clima.',
      safety: 'Tuvimos que cancelar la salida por razones de seguridad.',
      other: 'Tuvimos que cancelar la salida.',
    },
    refund: (amount: string) =>
      `Te devolvemos el 100 % de lo que pagaste: ${amount}, a la misma tarjeta. Según tu banco, puede tardar algunos días hábiles en verse.`,
    review:
      'Estamos revisando tu reserva y te vamos a escribir con la decisión: el reembolso del 100 %, el cambio a otra fecha sin costo o ningún reembolso.',
    noCharge: 'No se hizo ningún cobro a tu tarjeta.',
    tourLabel: 'Tour',
    dateLabel: 'Fecha y hora',
    cta: 'Ver otras fechas',
    closing: 'Lamentamos el inconveniente.',
  },
  en: {
    subject: (tour: string) => `We cancelled the departure — ${tour}`,
    greeting: (name: string) => `Hi ${name},`,
    reason: {
      minimum:
        'This departure did not reach the minimum number of participants, so we had to cancel it.',
      weather: 'We had to cancel the departure because of the weather conditions.',
      safety: 'We had to cancel the departure for safety reasons.',
      other: 'We had to cancel the departure.',
    },
    refund: (amount: string) =>
      `We are refunding 100% of what you paid: ${amount}, to the same card. Depending on your bank, it may take a few business days to appear.`,
    review:
      'We are reviewing your booking and will write to you with our decision: a 100% refund, a free change to another date, or no refund.',
    noCharge: 'Your card was not charged.',
    tourLabel: 'Tour',
    dateLabel: 'Date and time',
    cta: 'See other dates',
    closing: 'Sorry for the inconvenience.',
  },
};

function outcomeLine(outcome: DepartureOutcome, locale: EmailLocale): string {
  const t = COPY[locale];
  if (outcome.kind === 'review') return t.review;
  if (outcome.kind === 'no_charge') return t.noCharge;
  return t.refund(formatMoney(outcome.amountCents, outcome.currency, locale));
}

export function renderDepartureCancelled(
  props: DepartureCancelledProps,
  locale: EmailLocale,
): RenderedEmail {
  const t = COPY[locale];
  return composeEmail({
    subject: t.subject(props.tourName),
    greeting: t.greeting(props.customerName),
    paragraphs: [t.reason[props.reason], outcomeLine(props.outcome, locale)],
    rows: [
      [t.tourLabel, props.tourName],
      [t.dateLabel, formatDateTime(props.startsAt, locale)],
    ],
    cta: { label: t.cta, url: props.toursUrl },
    closing: t.closing,
  });
}
