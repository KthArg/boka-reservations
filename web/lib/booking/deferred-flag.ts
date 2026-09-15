import { env } from '@/lib/env';

const ENABLED = 'true';

/**
 * Flag del cobro diferido (spec 0029 §11). Lo lee solo la app: SQL deduce el flujo de cada
 * reserva. Apagarlo no revierte lo que ya está en vuelo.
 */
export function isDeferredChargeEnabled(): boolean {
  return env.DEFERRED_CHARGE_ENABLED === ENABLED;
}
