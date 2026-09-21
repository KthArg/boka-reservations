import * as Sentry from '@sentry/node';
import { env } from './env.js';
import { generateTourInstances } from './jobs/generate-tour-instances.js';
import { releaseExpiredHolds } from './jobs/release-expired-holds.js';
import { sendNotifications } from './jobs/send-notifications.js';
import { processRefunds } from './jobs/process-refunds.js';
import { reconcilePendingPayments } from './jobs/reconcile-pending-payments.js';
import { cleanupRateLimits } from './jobs/cleanup-rate-limits.js';
import { applyRetention } from './jobs/apply-retention.js';
import { watchCharges } from './jobs/watch-charges.js';
import { closePaymentIntents } from './jobs/close-payment-intents.js';

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
const FIVE_MINUTES_MS = 300_000;
const ONE_HOUR_MS = 3_600_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

// Graceful shutdown (spec 0028): Railway manda SIGTERM en cada deploy. Sin esperar el
// ciclo en curso, un deploy podía cortar entre el POST de un refund y la persistencia
// del external_refund_id (camino directo al doble reembolso).
let shuttingDown = false;
const timers: NodeJS.Timeout[] = [];
const inFlight = new Set<Promise<void>>();

function schedule(name: string, job: () => Promise<void>, intervalMs: number): void {
  const run = () => {
    if (shuttingDown) return;
    const p = job().catch((err) => {
      console.error(`[${name}] error:`, err);
      Sentry.captureException(err);
    });
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
  };
  run();
  timers.push(setInterval(run, intervalMs));
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} recibido; esperando ciclos en curso…`);
  for (const t of timers) clearInterval(t);
  // Tope defensivo: si un ciclo quedó colgado, no retener el deploy para siempre.
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS));
  await Promise.race([Promise.allSettled([...inFlight]).then(() => undefined), timeout]);
  console.log('[worker] shutdown limpio');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

function logAlive() {
  console.log(`[worker] alive — ${new Date().toISOString()}`);
}

logAlive();
timers.push(setInterval(logAlive, ALIVE_INTERVAL_MS));

// generate-tour-instances: al inicio y luego una vez al día
schedule('generate-tour-instances', generateTourInstances, ONE_DAY_MS);
// release-expired-holds: al inicio y luego cada minuto
schedule('release-expired-holds', releaseExpiredHolds, ONE_MINUTE_MS);
// send-notifications: al inicio y luego cada minuto
schedule('send-notifications', sendNotifications, ONE_MINUTE_MS);
// process-refunds: al inicio y luego cada minuto
schedule('process-refunds', processRefunds, ONE_MINUTE_MS);
// reconcile-pending-payments: al inicio y luego cada 5 minutos (el umbral es 30 min)
schedule('reconcile-pending-payments', reconcilePendingPayments, FIVE_MINUTES_MS);
// cleanup-rate-limits: al inicio y luego cada hora (purga ventanas vencidas, spec 0017)
schedule('cleanup-rate-limits', cleanupRateLimits, ONE_HOUR_MS);
// apply-retention: al inicio y luego una vez al día (retención de datos / PII, spec 0022)
schedule('apply-retention', applyRetention, ONE_DAY_MS);
// watch-charges: al inicio y luego cada minuto (watchdog del cobro diferido, spec 0029)
schedule('watch-charges', watchCharges, ONE_MINUTE_MS);
// close-payment-intents: al inicio y luego cada 5 minutos (barrido de intents y customers, spec 0029)
schedule('close-payment-intents', closePaymentIntents, FIVE_MINUTES_MS);
