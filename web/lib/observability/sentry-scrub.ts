import type { Event } from '@sentry/nextjs';

/**
 * Quita de los eventos de Sentry las credenciales que viajan en URLs, headers y cookies (spec
 * 0038): el token del enlace de la reserva y del guía, el token_hash o el code de los enlaces de
 * Auth, y la sesión. Sentry guarda los eventos 30 días y cualquiera con ese enlace podría ver o
 * cancelar la reserva.
 */

/** Tasa de muestreo de trazas, la misma en el navegador y en el servidor. */
export const SENTRY_TRACES_SAMPLE_RATE = 0.2;

const PATH_TOKEN = /(\/(?:booking|guide)\/)[^/?#]+/g;
const QUERY_TOKEN = /([?&](?:token_hash|code|token)=)[^&#]*/g;
const REDACTED = '[token]';

export function scrubUrl(url: string): string {
  return url.replace(PATH_TOKEN, `$1${REDACTED}`).replace(QUERY_TOKEN, `$1${REDACTED}`);
}

function scrubValue(value: unknown): unknown {
  return typeof value === 'string' ? scrubUrl(value) : value;
}

/** Headers con una URL de la página (Referer, la ruta de Next): se limpian. */
const URL_HEADERS = ['referer', 'next-url'];
/** Headers que llevan la sesión o el estado del router con la URL: se quitan. */
const DROPPED_HEADERS = ['cookie', 'authorization', 'next-router-state-tree'];
/** Claves de datos (breadcrumbs, spans, contexto de la traza) que llevan una URL. */
const URL_DATA_KEYS = ['url', 'to', 'from', 'http.url', 'url.full', 'http.target'];

function scrubData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of URL_DATA_KEYS) {
    if (key in data) data[key] = scrubValue(data[key]);
  }
}

function scrubRequest(request: NonNullable<Event['request']>): void {
  if (request.url) request.url = scrubUrl(request.url);
  if (typeof request.query_string === 'string') {
    request.query_string = scrubUrl(`?${request.query_string}`).slice(1);
  }
  delete request.cookies;
  const headers = request.headers;
  if (!headers) return;
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (DROPPED_HEADERS.includes(lower)) delete headers[name];
    else if (URL_HEADERS.includes(lower)) headers[name] = scrubUrl(headers[name]);
  }
}

/** Limpia pedido, headers, breadcrumbs, spans y el nombre de la transacción. */
export function scrubEvent<T extends Event>(event: T): T {
  // Se conserva el recorte de PII de usuario de PRIV-04 (spec 0023).
  if (event.user) event.user = { id: event.user.id };
  if (event.request) scrubRequest(event.request);
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubUrl(crumb.message);
    scrubData(crumb.data);
  }
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubUrl(span.description);
    scrubData(span.data as Record<string, unknown> | undefined);
  }
  scrubData(event.contexts?.trace?.data as Record<string, unknown> | undefined);
  return event;
}
