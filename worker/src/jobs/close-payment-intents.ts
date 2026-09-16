import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/node';
import { env } from '../env.js';
import { createOnvopayChargeClient, type OnvopayChargeClient } from '../charges/onvopay.js';
import { countUnclosedPastWindow, fetchUnclosedIntents } from '../charges/sweep-repository.js';
import { sweepOne } from '../charges/sweep.js';
import { cleanupCustomer, fetchCleanupCandidates } from '../charges/customer-cleanup.js';
import { createBatchRotation } from '../charges/batch-rotation.js';
import { alertCount, MSG_UNCLOSED_PAST_WINDOW } from '../charges/alerts.js';

// Ventana de cierre automático de un intent (§5.9): después, lo registra el staff a mano.
const CLOSURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const sweepRotation = createBatchRotation();
const cleanupRotation = createBatchRotation();

let isRunning = false;

/**
 * Barrido de intents no cerrados y limpieza de customers (spec 0029 §5.9), cada 5 minutos:
 *   1. cierra los intents de reservas diferidas canceladas (asienta los que liquidaron tarde);
 *   2. alerta los que pasaron la ventana de 7 días sin cierre;
 *   3. borra en OnvoPay los customers que ya ninguna reserva necesita.
 */
export async function closePaymentIntents(): Promise<void> {
  if (!env.ONVOPAY_SECRET_KEY) {
    console.warn('[close-payment-intents] ONVOPAY_SECRET_KEY ausente; se omite el ciclo');
    return;
  }
  if (isRunning) {
    console.warn('[close-payment-intents] ciclo anterior en curso; se omite');
    return;
  }
  isRunning = true;
  try {
    await runCycle(env.ONVOPAY_SECRET_KEY);
  } finally {
    isRunning = false;
  }
}

async function runCycle(secretKey: string): Promise<void> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const client = createOnvopayChargeClient(secretKey, env.ONVOPAY_API_BASE_URL);
  const now = new Date();
  const windowStart = new Date(now.getTime() - CLOSURE_WINDOW_MS).toISOString();

  // Pasos aislados: si falla la consulta del barrido, la limpieza igual corre.
  await isolated('barrido de intents', () => closeIntents(db, client, windowStart));
  await isolated('intents fuera de ventana', async () => {
    const pastWindow = await countUnclosedPastWindow(db, windowStart);
    if (pastWindow > 0) {
      alertCount(MSG_UNCLOSED_PAST_WINDOW, 'close-payment-intents-past-window', pastWindow);
    }
  });
  await isolated('limpieza de customers', () => cleanupCustomers(db, client, now));
}

async function closeIntents(
  db: SupabaseClient,
  client: OnvopayChargeClient,
  windowStart: string,
): Promise<void> {
  const intents = await fetchUnclosedIntents(db, windowStart, sweepRotation.window());
  sweepRotation.advance(intents.length);
  for (const intent of intents) {
    await isolated(`intent ${intent.id}`, () => sweepOne(db, client, intent));
  }
}

async function cleanupCustomers(
  db: SupabaseClient,
  client: OnvopayChargeClient,
  now: Date,
): Promise<void> {
  const holds = await fetchCleanupCandidates(db, cleanupRotation.window());
  cleanupRotation.advance(holds.length);
  for (const hold of holds) {
    await isolated(`customer del hold ${hold.id}`, async () => {
      await cleanupCustomer(db, client, hold, now);
    });
  }
}

// Aislamiento por ítem y por paso (spec 0028): un error no aborta el lote ni el ciclo.
async function isolated(what: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error(
      `[close-payment-intents] error en ${what}`,
      err instanceof Error ? err.message : 'unknown',
    );
    Sentry.captureException(err);
  }
}
