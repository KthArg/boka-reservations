import type { RenderedEmail } from '../types.js';
import { escapeHtml } from './format.js';
import { wrapHtml } from './layout.js';
import { EmailStyle } from './styles.js';

// Composición común de los emails del cobro diferido (spec 0029): saludo, párrafos, tabla de
// detalle, botón y cierre, con la misma estética que las plantillas existentes. Cada plantilla
// solo define su copy; acá se escapa todo lo que viene de datos.

export type DetailRow = readonly [label: string, value: string];

export type EmailContent = {
  subject: string;
  greeting: string;
  paragraphs: readonly string[];
  rows: readonly DetailRow[];
  cta: { label: string; url: string };
  closing: string;
};

const TABLE_STYLE = EmailStyle.detailTable;
const BUTTON_STYLE = EmailStyle.button;

function rowsHtml(rows: readonly DetailRow[]): string {
  return rows
    .map(
      ([label, value]) =>
        `<tr><td style="font-weight:600;">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`,
    )
    .join('');
}

export function composeEmail(content: EmailContent): RenderedEmail {
  const paragraphs = content.paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px;">${escapeHtml(paragraph)}</p>`)
    .join('');

  const html = wrapHtml(`
    <h1 style="${EmailStyle.h1}">${escapeHtml(content.greeting)}</h1>
    ${paragraphs}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="${TABLE_STYLE}">${rowsHtml(content.rows)}</table>
    <p style="margin:0 0 24px;">
      <a href="${escapeHtml(content.cta.url)}" style="${BUTTON_STYLE}">${escapeHtml(content.cta.label)}</a>
    </p>
    <p style="margin:0;color:${EmailStyle.muted};">${escapeHtml(content.closing)}</p>
  `);

  const text = [
    content.greeting,
    '',
    ...content.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...content.rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `${content.cta.label}: ${content.cta.url}`,
    '',
    content.closing,
  ].join('\n');

  return { subject: content.subject, html, text };
}
