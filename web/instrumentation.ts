import * as Sentry from '@sentry/nextjs';

export async function register() {
  // Validación de env al boot (spec 0028, B11): si falta una variable, el proceso muere
  // al arrancar el server — no en runtime a mitad de un flujo (patrón que ya mordió en
  // prod con los grants). Solo en el runtime Node (el edge no ve las vars server-only).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/lib/env');
  }

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
