// Content-Security-Policy con nonce por request (spec 0024). Reemplaza la CSP
// estática que vivía en next.config.ts (spec 0016, M-2): en `script-src` se cambia
// 'unsafe-inline' por 'nonce-<n>' + 'strict-dynamic'. El resto de directivas se
// conserva idéntico. Edge-safe (lo usa el middleware): sólo lee process.env
// (NEXT_PUBLIC_* queda inlineado en build) y arma strings; sin node:crypto.
//
// Bajo 'strict-dynamic' los navegadores modernos IGNORAN 'self'/hosts/https: en
// script-src y confían sólo en el nonce y en lo que ése cargue; esos tokens quedan
// como fallback para navegadores viejos sin soporte de strict-dynamic.

const ENFORCE_HEADER = 'content-security-policy';
const REPORT_ONLY_HEADER = 'content-security-policy-report-only';
const REPORT_ONLY_FLAG = 'true';
const PRODUCTION = 'production';

const ONVO_SDK = 'https://sdk.onvopay.com';
const ONVO_API = 'https://api.onvopay.com';
const ONVO_FRAME = 'https://*.onvopay.com';
const SENTRY = 'https://*.sentry.io';

function supabaseOrigins(): { http: string; ws: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const http = url ? new URL(url).origin : '';
  return { http, ws: http.replace(/^http/, 'ws') };
}

// Header bajo el que se emite la CSP: enforcing (default) o report-only durante el
// rollout (§11). Una sola política; sólo cambia el nombre del header. Next lee el
// nonce de cualquiera de los dos (app-render), así que report-only igual noncea.
export function cspHeaderName(): string {
  return process.env.CSP_REPORT_ONLY === REPORT_ONLY_FLAG ? REPORT_ONLY_HEADER : ENFORCE_HEADER;
}

// Arma el string de CSP para un nonce dado. 'unsafe-eval' sólo fuera de producción
// (Next lo necesita para HMR/React-refresh); en producción no se incluye.
export function buildCsp(nonce: string): string {
  const { http, ws } = supabaseOrigins();
  const devEval = process.env.NODE_ENV === PRODUCTION ? '' : `'unsafe-eval'`;
  return [
    `default-src 'self'`,
    `script-src 'nonce-${nonce}' 'strict-dynamic' ${devEval} 'self' https: ${ONVO_SDK}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${http} ${ws} ${ONVO_SDK} ${ONVO_API} ${SENTRY}`,
    `frame-src ${ONVO_SDK} ${ONVO_FRAME}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ]
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .join('; ');
}
