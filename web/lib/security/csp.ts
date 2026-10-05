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
// Librería del 3DS (spec 0029 §5.7): el script lo carga el bundle con nonce; puede pedir recursos
// a su propio origen. El desafío del banco corre en frames de *.onvopay.com.
const ONVO_JS = 'https://js.onvopay.com';
const ONVO_FRAME = 'https://*.onvopay.com';
const SENTRY = 'https://*.sentry.io';

// Prevención de fraude del SDK de OnvoPay en el 3DS (decisión del usuario, 2026-10-05; aviso de
// privacidad 2026-10-05, §2 y §4): consulta la IP del turista en dos servicios y carga la huella
// del dispositivo de ThreatMetrix. Solo se permiten en la página donde el banco pide confirmar
// un cobro; el resto del sitio sigue sin mandar la IP del visitante a ningún tercero.
const RISK_IP_LOOKUPS = 'https://api.ipify.org https://api.my-ip.io';
const RISK_DEVICE = 'https://h.online-metrix.net';
const AUTHENTICATE_PATH = /\/booking\/[^/]+\/authenticate\/?$/;

/** La página de confirmación del cobro con el banco (`/{locale}/booking/{token}/authenticate`). */
export function isChargeAuthenticationPath(pathname: string): boolean {
  return AUTHENTICATE_PATH.test(pathname);
}

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
// (Next lo necesita para HMR/React-refresh); en producción no se incluye. `pathname` decide si se
// suman los orígenes de prevención de fraude: solo en la página de confirmación del cobro.
export function buildCsp(nonce: string, pathname = ''): string {
  const { http, ws } = supabaseOrigins();
  const risk = isChargeAuthenticationPath(pathname);
  const riskConnect = risk ? `${RISK_IP_LOOKUPS} ${RISK_DEVICE}` : '';
  const riskDevice = risk ? RISK_DEVICE : '';
  const devEval = process.env.NODE_ENV === PRODUCTION ? '' : `'unsafe-eval'`;
  return [
    `default-src 'self'`,
    `script-src 'nonce-${nonce}' 'strict-dynamic' ${devEval} 'self' https: ${ONVO_SDK}`,
    `style-src 'self' 'unsafe-inline'`,
    // Spec 0036: solo imágenes propias, del almacenamiento y de la pasarela; ninguna URL de un
    // tercero recibe la IP del visitante, salvo la prevención de fraude en la página del 3DS.
    `img-src 'self' data: blob: ${http} ${ONVO_FRAME} ${riskDevice}`,
    `font-src 'self' data:`,
    `connect-src 'self' ${http} ${ws} ${ONVO_SDK} ${ONVO_API} ${ONVO_JS} ${SENTRY} ${riskConnect}`,
    `frame-src ${ONVO_SDK} ${ONVO_FRAME} ${riskDevice}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ]
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .join('; ');
}
