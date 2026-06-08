import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import {
  claimForProcessing,
  fetchActiveRefunds,
  loadPaymentIntentId,
  markFailed,
  markProcessing,
  markSucceeded,
  releaseClaim,
  type RefundRow,
} from '../refunds/repository.js';
import { createOnvopayRefundClient, type OnvopayRefundClient } from '../refunds/onvopay.js';

const MAX_CREATE_ATTEMPTS = 3;
// Tope de antigüedad de un refund en 'processing'. Si OnvoPay lo deja colgado
// en pending para siempre, o un crash dejó la fila reclamada sin
// external_refund_id, se marca 'failed' para que entre al retry manual del
// panel en vez de pollearse eternamente (evita reservas en limbo).
const MAX_PROCESSING_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Procesa los reembolsos encolados (spec 0011). OnvoPay no emite webhook de
 * refund, así que: 'pending' -> reclama la fila (single-flight) y crea el
 * refund (POST) -> 'processing'; 'processing' -> pollea (GET) -> 'succeeded' |
 * 'failed'. Reintentable e idempotente.
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

function isStale(refund: RefundRow): boolean {
  return Date.now() - new Date(refund.created_at).getTime() > MAX_PROCESSING_AGE_MS;
}

async function processOne(
  db: SupabaseClient,
  client: OnvopayRefundClient,
  refund: RefundRow,
): Promise<void> {
  if (refund.status === 'processing') {
    if (refund.external_refund_id) {
      await pollRefund(db, client, refund);
      return;
    }
    // Reclamado pero sin external_refund_id: un crash entre el claim y el POST.
    // No se puede repostear sin arriesgar doble reembolso (OnvoPay no expone
    // clave de idempotencia); se deja envejecer hasta el guard de antigüedad.
    if (isStale(refund)) {
      await markFailed(db, refund, 'processing-stale', refund.attempts);
    }
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

  // Single-flight: reclamar la fila ANTES de llamar a OnvoPay. Si otro ciclo del
  // worker ya la reclamó, no postear (así no se duplica el reembolso).
  const claimed = await claimForProcessing(db, refund.id, attempts);
  if (!claimed) return;

  try {
    const result = await client.createRefund({
      externalPaymentId: paymentIntentId,
      amountCents: refund.amount_cents,
    });
    await markProcessing(db, refund.id, result.externalRefundId, attempts);
    // Algunos refunds resuelven sincrónico en el POST.
    if (result.status !== 'pending') {
      await settle(db, { ...refund, attempts }, result.status, result.failureReason);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    if (attempts >= MAX_CREATE_ATTEMPTS) {
      await markFailed(db, refund, message, attempts);
      return;
    }
    // Fallo transitorio: devolver la fila a 'pending' para reintentar en el
    // próximo ciclo (libera el claim sin perder la cuenta de intentos).
    await releaseClaim(db, refund.id, attempts);
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
      return;
    }
    // Sigue 'pending' en OnvoPay: si lleva demasiado tiempo, cortarlo para que
    // el staff pueda reintentarlo manualmente.
    if (isStale(refund)) {
      await markFailed(db, refund, 'processing-timeout', refund.attempts);
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
