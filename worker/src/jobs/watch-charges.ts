import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/node';
import { env } from '../env.js';
import { createOnvopayChargeClient, type OnvopayChargeClient } from '../charges/onvopay.js';
import {
  fetchExpiredRecoveries,
  fetchInFlightCharges,
  fetchStartedUnpaid,
  type UnpaidCandidate,
} from '../charges/in-flight-repository.js';
import {
  createBatchRotation,
  type BatchRotation,
  type BatchWindow,
} from '../charges/batch-rotation.js';
import { CancelUnpaidReason, type CancelUnpaidReasonValue } from '../charges/rpc.js';
import { watchOne } from '../charges/watch.js';
import { cancelUnpaidOne } from '../charges/unpaid-cancel.js';

// Un cobro en vuelo más reciente sigue en manos de quien lo inició (worker o panel).
const IN_FLIGHT_GRACE_MS = 30 * 60 * 1000;

const inFlightRotation = createBatchRotation();
const expiredRotation = createBatchRotation();
const startedRotation = createBatchRotation();

let isRunning = false;

/**
 * Watchdog del cobro diferido (spec 0029 §5.5, §5.7, §5.9), cada minuto:
 *   1. resuelve los cobros en vuelo por el GET del intent;
 *   2. cancela las reservas sin cobrar cuyo plazo de recuperación venció;
 *   3. red terminal: cancela las reservas sin cobrar de salidas que ya empezaron.
 * Existe desde B porque el cobro manual del panel ya puede quedar en 3DS, timeout o webhook
 * perdido. Sin la llave de OnvoPay, los pasos 2 y 3 cancelan solo las reservas sin intent.
 */
export async function watchCharges(): Promise<void> {
  if (isRunning) {
    console.warn('[watch-charges] ciclo anterior en curso; se omite');
    return;
  }
  isRunning = true;
  try {
    await runCycle();
  } finally {
    isRunning = false;
  }
}

async function runCycle(): Promise<void> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const client = env.ONVOPAY_SECRET_KEY
    ? createOnvopayChargeClient(env.ONVOPAY_SECRET_KEY, env.ONVOPAY_API_BASE_URL)
    : null;
  if (!client) console.warn('[watch-charges] ONVOPAY_SECRET_KEY ausente; sin GET de intents');
  const now = new Date();
  const nowIso = now.toISOString();

  // Pasos aislados: un fallo de consulta en uno no frena a los demás.
  await isolated('cobros en vuelo', () => resolveInFlight(db, client, now));
  await isolated('plazos vencidos', () =>
    cancelUnpaid(db, client, expiredRotation, CancelUnpaidReason.RecoveryExpired, (window) =>
      fetchExpiredRecoveries(db, nowIso, window),
    ),
  );
  await isolated('salidas empezadas', () =>
    cancelUnpaid(db, client, startedRotation, CancelUnpaidReason.DepartureStarted, (window) =>
      fetchStartedUnpaid(db, nowIso, window),
    ),
  );
}

async function resolveInFlight(
  db: SupabaseClient,
  client: OnvopayChargeClient | null,
  now: Date,
): Promise<void> {
  if (!client) return;
  const startedBefore = new Date(now.getTime() - IN_FLIGHT_GRACE_MS).toISOString();
  const charges = await fetchInFlightCharges(db, startedBefore, inFlightRotation.window());
  inFlightRotation.advance(charges.length);
  for (const charge of charges) {
    await isolated(`cobro ${charge.id}`, () => watchOne(db, client, charge, now));
  }
}

async function cancelUnpaid(
  db: SupabaseClient,
  client: OnvopayChargeClient | null,
  rotation: BatchRotation,
  reason: CancelUnpaidReasonValue,
  fetch: (window: BatchWindow) => Promise<UnpaidCandidate[]>,
): Promise<void> {
  const candidates = await fetch(rotation.window());
  rotation.advance(candidates.length);
  for (const candidate of candidates) {
    await isolated(`reserva ${candidate.id} (${reason})`, () =>
      cancelUnpaidOne(db, client, candidate, reason),
    );
  }
}

// Aislamiento por ítem y por paso (spec 0028): un error no aborta el lote ni el ciclo.
async function isolated(what: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error(
      `[watch-charges] error en ${what}`,
      err instanceof Error ? err.message : 'unknown',
    );
    Sentry.captureException(err);
  }
}

export const __testing = { runCycle };
