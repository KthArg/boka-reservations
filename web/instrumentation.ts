import * as Sentry from '@sentry/nextjs';
import { SENTRY_TRACES_SAMPLE_RATE, scrubEvent } from '@/lib/observability/sentry-scrub';

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
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    // PRIV-04 (spec 0023): sin PII por defecto. Spec 0038: sin los tokens de las URLs.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    // Sin cookies ni cuerpo del pedido en los eventos del servidor: llevan la sesión (spec 0038).
    integrations: [Sentry.requestDataIntegration({ include: { cookies: false, data: false } })],
  });
}

export const onRequestError = Sentry.captureRequestError;
