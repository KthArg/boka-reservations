import { EmailColor } from './styles.js';

/**
 * Marcador del pie legal (spec 0034). Cada plantilla envuelve su cuerpo con `wrapHtml`, y
 * `send-notifications` reemplaza el marcador con el pie del operador justo antes de enviar.
 */
export const LEGAL_FOOTER_MARKER = '<!--legal-footer-->';

/**
 * Encabezado con el nombre de la marca en texto (spec 0042). Al enviar, `withLegalFooter` lo
 * cambia por el logo, que necesita la URL del sitio; si el correo se arma sin ese paso (tests,
 * vistas previas), queda el nombre en texto.
 */
export const BRAND_TEXT_HEADER = `<span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:${EmailColor.bone};">Boka Verde</span>`;

export function wrapHtml(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:24px 12px;background:${EmailColor.bone};font-family:Montserrat,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${EmailColor.night};line-height:1.6;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:${EmailColor.card};border:1px solid ${EmailColor.line};border-radius:20px;overflow:hidden;">
      <tr>
        <td style="background:${EmailColor.night};padding:24px 32px;">${BRAND_TEXT_HEADER}</td>
      </tr>
      <tr>
        <td style="padding:32px;">${bodyHtml}</td>
      </tr>
    </table>
    ${LEGAL_FOOTER_MARKER}
  </body>
</html>`;
}
