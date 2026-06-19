import * as Sentry from '@sentry/nextjs';

export async function register() {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: process.env.NODE_ENV === 'production' && !!process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.2,
    // PRIV-04 (spec 0023): no enviar PII por defecto + recortar PII de usuario de los eventos.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.user) event.user = { id: event.user.id };
      return event;
    },
  });
}

export const onRequestError = Sentry.captureRequestError;
