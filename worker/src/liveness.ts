import * as Sentry from '@sentry/node';

// Latido del worker (spec 0029 §11): con el cobro diferido, un worker caído significa cero
// ingresos, cupos retenidos e intents sin cerrar, y nadie lo nota porque no tiene tráfico HTTP
// (estuvo caído dos meses en 2026 sin que nada avisara). Cada ciclo de watch-charges manda un
// check-in a un monitor de Sentry; si dejan de llegar, Sentry abre la alerta. El monitor se crea
// solo con el primer check-in. Sin DSN, o fuera de producción, no hace nada.

const MONITOR_SLUG = 'worker-cobros';
const CHECK_IN_EVERY_MINUTES = 1;
/** Minutos de gracia antes de dar un check-in por perdido: cubre un deploy de Railway. */
const MARGIN_MINUTES = 5;
/** Check-ins perdidos seguidos para abrir la alerta, y buenos para cerrarla. */
const FAILURE_THRESHOLD = 2;
const RECOVERY_THRESHOLD = 1;

const MONITOR_CONFIG = {
  schedule: { type: 'interval', value: CHECK_IN_EVERY_MINUTES, unit: 'minute' },
  checkinMargin: MARGIN_MINUTES,
  maxRuntime: MARGIN_MINUTES,
  failureIssueThreshold: FAILURE_THRESHOLD,
  recoveryThreshold: RECOVERY_THRESHOLD,
} as const;

/** Envuelve el job que late: un ciclo terminado es un check-in bueno; uno que lanza, malo. */
export function withHeartbeat(job: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await job();
      Sentry.captureCheckIn({ monitorSlug: MONITOR_SLUG, status: 'ok' }, MONITOR_CONFIG);
    } catch (err) {
      Sentry.captureCheckIn({ monitorSlug: MONITOR_SLUG, status: 'error' }, MONITOR_CONFIG);
      throw err;
    }
  };
}
