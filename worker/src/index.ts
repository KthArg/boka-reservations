import * as Sentry from '@sentry/node';
import { env } from './env.js';
import { generateTourInstances } from './jobs/generate-tour-instances.js';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    enabled: env.NODE_ENV === 'production',
    tracesSampleRate: 0.2,
  });
}

const ALIVE_INTERVAL_MS = 30_000;
const ONE_DAY_MS = 86_400_000;

function logAlive() {
  console.log(`[worker] alive — ${new Date().toISOString()}`);
}

async function runGenerateTourInstances() {
  try {
    await generateTourInstances();
  } catch (err) {
    console.error('[generate-tour-instances] error:', err);
    Sentry.captureException(err);
  }
}

logAlive();
setInterval(logAlive, ALIVE_INTERVAL_MS);

// Correr al inicio y luego una vez al día
void runGenerateTourInstances();
setInterval(() => {
  void runGenerateTourInstances();
}, ONE_DAY_MS);
