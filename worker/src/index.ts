import * as Sentry from '@sentry/node';
import { env } from './env.js';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    enabled: env.NODE_ENV === 'production',
    tracesSampleRate: 0.2,
  });
}

const ALIVE_INTERVAL_MS = 30_000;

function logAlive() {
  console.log(`[worker] alive — ${new Date().toISOString()}`);
}

logAlive();
setInterval(logAlive, ALIVE_INTERVAL_MS);
