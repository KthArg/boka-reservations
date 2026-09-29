import type { Event } from '@sentry/nextjs';

/**
 * Quita de los eventos de Sentry las credenciales que viajan en la URL (spec 0038): el token del
 * enlace de la reserva y del guía, y el token_hash o el code de los enlaces de Auth. Sentry guarda
 * los eventos 30 días y cualquiera con ese enlace podría ver o cancelar la reserva.
 */

const PATH_TOKEN = /(\/(?:booking|guide)\/)[^/?#]+/g;
const QUERY_TOKEN = /([?&](?:token_hash|code|token)=)[^&#]*/g;
const REDACTED = '[token]';

export function scrubUrl(url: string): string {
  return url.replace(PATH_TOKEN, `$1${REDACTED}`).replace(QUERY_TOKEN, `$1${REDACTED}`);
}

function scrubValue(value: unknown): unknown {
  return typeof value === 'string' ? scrubUrl(value) : value;
}

const BREADCRUMB_URL_KEYS = ['url', 'to', 'from'] as const;

/** Limpia la URL del pedido, las de los breadcrumbs y el nombre de la transacción. */
export function scrubEvent<T extends Event>(event: T): T {
  // Se conserva el recorte de PII de usuario de PRIV-04 (spec 0023).
  if (event.user) event.user = { id: event.user.id };
  if (event.request?.url) event.request.url = scrubUrl(event.request.url);
  if (typeof event.request?.query_string === 'string') {
    event.request.query_string = scrubUrl(`?${event.request.query_string}`).slice(1);
  }
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubUrl(crumb.message);
    if (!crumb.data) continue;
    for (const key of BREADCRUMB_URL_KEYS) {
      if (key in crumb.data) crumb.data[key] = scrubValue(crumb.data[key]);
    }
  }
  return event;
}
