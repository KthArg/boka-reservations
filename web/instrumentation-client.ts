import * as Sentry from '@sentry/nextjs';
import { SENTRY_TRACES_SAMPLE_RATE, scrubEvent } from '@/lib/observability/sentry-scrub';

// SDK de Sentry en el navegador (spec 0038). En @sentry/nextjs v10 reemplaza a
// sentry.client.config.ts. Misma configuración que el servidor (instrumentation.ts).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === 'production' && !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  // PRIV-04 (spec 0023): sin PII por defecto. Spec 0038: sin los tokens de las URLs.
  sendDefaultPii: false,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
