import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import {
  bumpAttempts,
  fetchActiveRefunds,
  loadPaymentIntentId,
  markFailed,
  markProcessing,
  markSucceeded,
  type RefundRow,
} from '../refunds/repository.js';
import { createOnvopayRefundClient, type OnvopayRefundClient } from '../refunds/onvopay.js';

const MAX_CREATE_ATTEMPTS = 3;

/**
 * Procesa los reembolsos encolados (spec 0011). OnvoPay no emite webhook de
 * refund, así que: 'pending' -> crea el refund (POST) -> 'processing';
 * 'processing' -> pollea (GET) -> 'succeeded' | 'failed'. Reintentable.
 */
export async function processRefunds(): Promise<void> {
  if (!env.ONVOPAY_SECRET_KEY) {
    console.warn('[process-refunds] ONVOPAY_SECRET_KEY ausente; se omite el ciclo');
    return;
  }

  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const refunds = await fetchActiveRefunds(db);
  if (refunds.length === 0) return;

  const client = createOnvopayRefundClient(env.ONVOPAY_SECRET_KEY);
  for (const refund of refunds) {
    await processOne(db, client, refund);
  }
}

async function processOne(
  db: SupabaseClient,
  client: OnvopayRefundClient,
  refund: RefundRow,
): Promise<void> {
  if (refund.status === 'processing' && refund.external_refund_id) {
    await pollRefund(db, client, refund);
    return;
  }
  await createRefund(db, client, refund);
}

async function createRefund(
  db: SupabaseClient,
  client: OnvopayRefundClient,
  refund: RefundRow,
): Promise<void> {
  const paymentIntentId = await loadPaymentIntentId(db, refund.payment_id);
  if (!paymentIntentId) {
    await markFailed(db, refund, 'payment-intent-missing', refund.attempts + 1);
    return;
  }

  const attempts = refund.attempts + 1;
  try {
    const result = await client.createRefund({
      externalPaymentId: paymentIntentId,
      amountCents: refund.amount_cents,
    });
    await markProcessing(db, refund.id, result.externalRefundId, attempts);
    // Resultado inmediato disponible (algunos refunds resuelven sincrónico).
    if (result.status !== 'pending') {
      await settle(db, { ...refund, attempts }, result.status, result.failureReason);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    if (attempts >= MAX_CREATE_ATTEMPTS) {
      await markFailed(db, refund, message, attempts);
      return;
    }
    await bumpAttempts(db, refund.id, attempts);
    console.error('[process-refunds] create error, reintentará:', message);
  }
}

async function pollRefund(
  db: SupabaseClient,
  client: OnvopayRefundClient,
  refund: RefundRow,
): Promise<void> {
  try {
    const result = await client.getRefund(refund.external_refund_id as string);
    if (result.status !== 'pending') {
      await settle(db, refund, result.status, result.failureReason);
    }
  } catch (err) {
    // Transitorio: se reintenta en el próximo ciclo sin cambiar de estado.
    console.error('[process-refunds] poll error:', err instanceof Error ? err.message : err);
  }
}

async function settle(
  db: SupabaseClient,
  refund: RefundRow,
  status: 'succeeded' | 'failed',
  failureReason?: string,
): Promise<void> {
  if (status === 'succeeded') {
    await markSucceeded(db, refund);
    return;
  }
  await markFailed(db, refund, failureReason ?? 'refund-failed', refund.attempts);
}

export const __testing = { processOne };
