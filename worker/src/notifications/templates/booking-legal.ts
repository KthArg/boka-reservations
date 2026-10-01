import type { EmailLocale } from '../types.js';
import { escapeHtml } from './format.js';
import { EmailStyle } from './styles.js';

// Parte legal del correo de confirmación (spec 0034; textos aprobados §3.6): el enlace personal
// y que no se comparta, la política de cancelación, la tolerancia de llegada tarde y las
// versiones aceptadas con enlace a cada una. La cláusula 2 de los términos promete ese enlace.

// Espejo de las versiones publicadas en web/content/legal/registry.ts (el worker no importa
// @shared ni la web en runtime). Una versión que no está acá no tiene página: el correo no la
// enlaza, para no mandar al turista a un 404 ni mostrarle un marcador de borrador.
const PUBLISHED_TERMS_VERSIONS: readonly string[] = ['2026-09-27'];
const PUBLISHED_PRIVACY_VERSIONS: readonly string[] = ['2026-09-27'];
const TERMS_SEGMENT = 'terms';
const PRIVACY_SEGMENT = 'privacy';

export type BookingLegalInput = {
  appUrl: string;
  termsVersion: string | null;
  privacyVersion: string | null;
  /** Tolerancia copiada a la reserva al crearla; null en reservas anteriores a los términos. */
  toleranceMinutes: number | null;
};

const COPY = {
  es: {
    linkNote: 'Con este enlace podés consultar o cancelar tu reserva. No lo compartas.',
    cancellation:
      'Cancelación: si cancelás con 24 horas o más de anticipación te devolvemos el 100 %; con menos de 24 horas, o si no te presentás, no hay reembolso. Si la salida se cancela por clima o seguridad, no hay reembolso automático: revisamos tu reserva y te escribimos con la decisión.',
    tolerance: (minutes: number) =>
      `Tolerancia de llegada tarde: ${minutes} minutos. Después se considera no presentación.`,
    accepted: 'Aceptaste los',
    terms: (version: string) => `Términos y condiciones (versión ${version})`,
    and: 'y el',
    privacy: (version: string) => `Aviso de privacidad (versión ${version})`,
  },
  en: {
    linkNote: 'With this link you can view or cancel your booking. Do not share it.',
    cancellation:
      'Cancellation: if you cancel 24 hours or more in advance we refund 100%; with less than 24 hours, or if you do not show up, there is no refund. If the departure is cancelled because of the weather or for safety reasons, there is no automatic refund: we review your booking and write to you with our decision.',
    tolerance: (minutes: number) =>
      `Late-arrival tolerance: ${minutes} minutes. After that it counts as a no-show.`,
    accepted: 'You accepted the',
    terms: (version: string) => `Terms and conditions (version ${version})`,
    and: 'and the',
    privacy: (version: string) => `Privacy notice (version ${version})`,
  },
};

function versionUrl(input: BookingLegalInput, locale: EmailLocale, text: string, version: string) {
  return `${input.appUrl}/${locale}/${text}/${version}`;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;color:${EmailStyle.muted};font-size:14px;">${html}</p>`;
}

/** Bloques HTML y líneas de texto plano de la parte legal, en el idioma del correo. */
export function renderBookingLegal(
  input: BookingLegalInput,
  locale: EmailLocale,
): { html: string; text: string[] } {
  const t = COPY[locale];
  const html = [paragraph(t.linkNote), paragraph(escapeHtml(t.cancellation))];
  const text = [t.linkNote, '', t.cancellation];

  if (input.toleranceMinutes !== null) {
    html.push(paragraph(escapeHtml(t.tolerance(input.toleranceMinutes))));
    text.push('', t.tolerance(input.toleranceMinutes));
  }

  if (
    input.termsVersion &&
    input.privacyVersion &&
    PUBLISHED_TERMS_VERSIONS.includes(input.termsVersion) &&
    PUBLISHED_PRIVACY_VERSIONS.includes(input.privacyVersion)
  ) {
    const termsUrl = versionUrl(input, locale, TERMS_SEGMENT, input.termsVersion);
    const privacyUrl = versionUrl(input, locale, PRIVACY_SEGMENT, input.privacyVersion);
    html.push(
      paragraph(
        `${t.accepted} <a href="${escapeHtml(termsUrl)}" style="${EmailStyle.link}">${escapeHtml(t.terms(input.termsVersion))}</a> ${t.and} <a href="${escapeHtml(privacyUrl)}" style="${EmailStyle.link}">${escapeHtml(t.privacy(input.privacyVersion))}</a>.`,
      ),
    );
    text.push(
      '',
      `${t.accepted} ${t.terms(input.termsVersion)}: ${termsUrl}`,
      `${t.and} ${t.privacy(input.privacyVersion)}: ${privacyUrl}`,
    );
  }

  return { html: html.join('\n'), text };
}
