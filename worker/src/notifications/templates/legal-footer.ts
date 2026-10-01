import type { EmailLocale, RenderedEmail } from '../types.js';
import { isFooterIdentityComplete, type OperatorIdentity } from '../operator.js';
import { escapeHtml } from './format.js';
import { BRAND_TEXT_HEADER, LEGAL_FOOTER_MARKER } from './layout.js';
import { EmailColor } from './styles.js';

// Pie de todos los correos (spec 0034; textos aprobados §3.5). Se inserta en un solo punto, al
// enviar, para que ninguna de las plantillas quede sin él: `wrapHtml` deja el marcador y
// `send-notifications` lo reemplaza con la identidad del operador leída una vez por ciclo.

/** A quién va el correo: al turista le recuerda por qué lo recibe; al guía no. */
export const FooterAudience = {
  Customer: 'customer',
  Guide: 'guide',
} as const;

export type FooterAudienceValue = (typeof FooterAudience)[keyof typeof FooterAudience];

const COPY = {
  es: {
    why: (brand: string) =>
      `Recibiste este correo porque hiciste una reserva con ${brand}. No enviamos correos promocionales.`,
    identity: (op: OperatorIdentity) =>
      `${op.legalName}, cédula jurídica ${op.taxId}, ${op.address}. Consultas y reclamos: ${op.contactEmail}, ${op.phone}.`,
    terms: 'Términos y condiciones',
    privacy: 'Aviso de privacidad',
  },
  en: {
    why: (brand: string) =>
      `You received this email because you made a booking with ${brand}. We do not send promotional emails.`,
    identity: (op: OperatorIdentity) =>
      `${op.legalName}, legal ID ${op.taxId}, ${op.address}. Questions and complaints: ${op.contactEmail}, ${op.phone}.`,
    terms: 'Terms and conditions',
    privacy: 'Privacy notice',
  },
};

type FooterInput = {
  operator: OperatorIdentity;
  locale: EmailLocale;
  audience: FooterAudienceValue;
  appUrl: string;
};

function footerLines({ operator, locale, audience }: FooterInput): string[] {
  const t = COPY[locale];
  if (!isFooterIdentityComplete(operator)) return [];
  const lines = [t.identity(operator)];
  if (audience === FooterAudience.Customer) lines.unshift(t.why(operator.brand));
  return lines;
}

/** Logo de la marca servido por la app (spec 0042); el texto alternativo cubre a quien bloquea imágenes. */
function brandLogo(appUrl: string): string {
  const src = escapeHtml(`${appUrl}/brand/logo-hueso.png`);
  return `<img src="${src}" width="132" height="47" alt="Boka Verde" style="display:block;width:132px;height:auto;border:0;font-family:Georgia,serif;font-size:22px;color:${EmailColor.bone};">`;
}

/**
 * Devuelve el correo con el pie legal en el HTML (en el marcador) y al final del texto plano, y
 * con el logo en el encabezado (spec 0042).
 */
export function withLegalFooter(email: RenderedEmail, input: FooterInput): RenderedEmail {
  const t = COPY[input.locale];
  const termsUrl = `${input.appUrl}/${input.locale}/terms`;
  const privacyUrl = `${input.appUrl}/${input.locale}/privacy`;
  const lines = footerLines(input);

  const html = `<div style="max-width:560px;margin:16px auto 0;text-align:center;font-size:12px;color:${EmailColor.muted};line-height:1.6;">
      ${lines.map((line) => `<p style="margin:0 0 6px;">${escapeHtml(line)}</p>`).join('')}
      <p style="margin:0;"><a href="${escapeHtml(termsUrl)}" style="color:${EmailColor.muted};">${t.terms}</a> · <a href="${escapeHtml(privacyUrl)}" style="color:${EmailColor.muted};">${t.privacy}</a></p>
    </div>`;
  const text = [...lines, `${t.terms}: ${termsUrl}`, `${t.privacy}: ${privacyUrl}`].join('\n');

  return {
    subject: email.subject,
    html: email.html
      .replace(LEGAL_FOOTER_MARKER, html)
      .replace(BRAND_TEXT_HEADER, brandLogo(input.appUrl)),
    text: `${email.text}\n\n--\n${text}`,
  };
}
