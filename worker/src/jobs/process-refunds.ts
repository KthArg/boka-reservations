import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/node';
import { env } from '../env.js';
import { fetchActiveRefunds } from '../refunds/repository.js';
import { processOne } from '../refunds/handle-refund.js';
import { createOnvopayRefundClient } from '../refunds/onvopay.js';

// Single-flight a nivel módulo (spec 0028): si el ciclo anterior sigue corriendo
// (p. ej. OnvoPay lento), este se saltea. Mismo patrón que el reconciliador.
let isRunning = false;

/**
 * Procesa los reembolsos encolados (spec 0011). OnvoPay no emite webhook de
 * refund, así que: 'pending' -> reclama la fila (single-flight) y crea el
 * refund (POST) -> 'processing'; 'processing' -> pollea (GET) -> 'succeeded' |
 * 'failed'. Reintentable e idempotente. La lógica por-refund vive en
 * refunds/handle-refund.ts (spec 0028); este job solo orquesta el ciclo.
 */
export async function processRefunds(): Promise<void> {
  if (!env.ONVOPAY_SECRET_KEY) {
    console.warn('[process-refunds] ONVOPAY_SECRET_KEY ausente; se omite el ciclo');
    return;
  }
  if (isRunning) {
    console.warn('[process-refunds] ciclo anterior en curso; se omite');
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

  const refunds = await fetchActiveRefunds(db);
  if (refunds.length === 0) return;

  const client = createOnvopayRefundClient(secretKey, env.ONVOPAY_API_BASE_URL);
  for (const refund of refunds) {
    // Aislamiento por ítem (spec 0028): un error inesperado en un refund no
    // aborta el lote; se reporta y el resto del lote continúa.
    try {
      await processOne(db, client, refund);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('[process-refunds] error en refund', refund.id, message);
      Sentry.captureException(err);
    }
  }
}

export const __testing = { processOne };
