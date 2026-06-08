import * as Sentry from '@sentry/node';
import { env } from './env.js';
import { generateTourInstances } from './jobs/generate-tour-instances.js';
import { releaseExpiredHolds } from './jobs/release-expired-holds.js';
import { sendNotifications } from './jobs/send-notifications.js';
import { processRefunds } from './jobs/process-refunds.js';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    enabled: env.NODE_ENV === 'production',
    tracesSampleRate: 0.2,
  });
}

const ALIVE_INTERVAL_MS = 30_000;
const ONE_DAY_MS = 86_400_000;
const ONE_MINUTE_MS = 60_000;

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

async function runReleaseExpiredHolds() {
  try {
    await releaseExpiredHolds();
  } catch (err) {
    console.error('[release-expired-holds] error:', err);
    Sentry.captureException(err);
  }
}

async function runSendNotifications() {
  try {
    await sendNotifications();
  } catch (err) {
    console.error('[send-notifications] error:', err);
    Sentry.captureException(err);
  }
}

async function runProcessRefunds() {
  try {
    await processRefunds();
  } catch (err) {
    console.error('[process-refunds] error:', err);
    Sentry.captureException(err);
  }
}

logAlive();
setInterval(logAlive, ALIVE_INTERVAL_MS);

// generate-tour-instances: al inicio y luego una vez al día
void runGenerateTourInstances();
setInterval(() => {
  void runGenerateTourInstances();
}, ONE_DAY_MS);

// release-expired-holds: al inicio y luego cada minuto
void runReleaseExpiredHolds();
setInterval(() => {
  void runReleaseExpiredHolds();
}, ONE_MINUTE_MS);

// send-notifications: al inicio y luego cada minuto
void runSendNotifications();
setInterval(() => {
  void runSendNotifications();
}, ONE_MINUTE_MS);

// process-refunds: al inicio y luego cada minuto
void runProcessRefunds();
setInterval(() => {
  void runProcessRefunds();
}, ONE_MINUTE_MS);
