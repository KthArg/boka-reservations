/**
 * Marcador del pie legal (spec 0034). Cada plantilla envuelve su cuerpo con `wrapHtml`, y
 * `send-notifications` reemplaza el marcador con el pie del operador justo antes de enviar.
 */
export const LEGAL_FOOTER_MARKER = '<!--legal-footer-->';

export function wrapHtml(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
      <tr>
        <td>${bodyHtml}</td>
      </tr>
    </table>
    ${LEGAL_FOOTER_MARKER}
  </body>
</html>`;
}
