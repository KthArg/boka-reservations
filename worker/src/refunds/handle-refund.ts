import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/node';
import {
  claimForProcessing,
  loadPaymentIntentId,
  markFailed,
  markProcessing,
  markSucceeded,
  releaseClaim,
  type RefundRow,
} from './repository.js';
import type { OnvopayRefundClient } from './onvopay.js';

// 3 REINTENTOS reales tras el primer intento (esperas 1/5/30): terminal recién al
// agotar el schedule (4to intento fallido). Con `>=` el reintento de 30 min era
// inalcanzable — mismo off-by-one corregido en notifications (spec 0028, review pre-PR).
const MAX_CREATE_ATTEMPTS = 3;
// Tope de antigüedad de un refund en 'processing'. Si OnvoPay lo deja colgado
// en pending para siempre, o un crash dejó la fila reclamada sin
// external_refund_id, se marca 'failed' para que entre al retry manual del
// panel en vez de pollearse eternamente (evita reservas en limbo).
const MAX_PROCESSING_AGE_MS = 24 * 60 * 60 * 1000;
// Backoff real 1/5/30 min entre intentos de creación (spec 0028): espera mínima
// antes del intento N+1, medida desde updated_at (el trigger lo refresca en cada
// claim/release). Sin esto, 3 intentos con ciclo de 1 min = ~3 min de tolerancia
// a una caída de OnvoPay, en vez de la ventana 1/5/30 de la convención.
const CREATE_BACKOFF_MS: readonly number[] = [60_000, 300_000, 1_800_000];
const AMBIGUOUS_TIMEOUT_REASON = 'ambiguous-timeout';

function isStale(refund: RefundRow): boolean {
  return Date.now() - new Date(refund.created_at).getTime() > MAX_PROCESSING_AGE_MS;
}

function backoffElapsed(refund: RefundRow): boolean {
  if (refund.attempts === 0) return true;
  const idx = Math.min(refund.attempts - 1, CREATE_BACKOFF_MS.length - 1);
  const wait = CREATE_BACKOFF_MS[idx] ?? 0;
  return Date.now() - new Date(refund.updated_at).getTime() >= wait;
}

// AbortSignal.timeout lanza DOMException con name 'TimeoutError' (Node >= 17.3);
// 'AbortError' cubre señales abortadas por otras vías.
function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

/**
 * Maneja UN refund según su estado. Regla de oro (spec 0028): NUNCA se re-POSTea
 * un refund cuyo resultado anterior sea desconocido o que ya tenga
 * external_refund_id — verificar (GET) antes que crear.
 */
export async function processOne(
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
  // 'pending' CON external_refund_id (spec 0028): el refund ya existe en OnvoPay
  // (retry manual legado o markProcessing fallido). NUNCA re-POSTear: se reclama
  // (single-flight) y se verifica el existente por GET.
  if (refund.external_refund_id) {
    const claimed = await claimForProcessing(db, refund.id, refund.attempts);
    if (claimed) await pollRefund(db, client, refund);
    return;
  }
  if (!backoffElapsed(refund)) return;
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

  let result;
  try {
    result = await client.createRefund({
      externalPaymentId: paymentIntentId,
      amountCents: refund.amount_cents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    // Timeout = respuesta desconocida: el refund PUDO haberse creado en OnvoPay.
    // Re-POSTear arriesga doble reembolso (spec 0028): se corta a 'failed' para
    // verificación manual contra el dashboard antes de cualquier reintento.
    if (isTimeout(err)) {
      await markFailed(db, refund, AMBIGUOUS_TIMEOUT_REASON, attempts);
      alertRefund(
        'refund-ambiguous-timeout',
        refund.id,
        '[process-refunds] timeout ambiguo del POST: verificar en OnvoPay antes de reintentar',
      );
      return;
    }
    if (attempts > MAX_CREATE_ATTEMPTS) {
      await markFailed(db, refund, message, attempts);
      return;
    }
    // Fallo transitorio con respuesta clara: devolver la fila a 'pending'; el
    // backoff 1/5/30 (backoffElapsed) espacia el próximo intento.
    await releaseClaim(db, refund.id, attempts);
    console.error('[process-refunds] create error, reintentará:', message);
    return;
  }

  // POST exitoso: persistir el id externo es CRÍTICO (evita el doble refund). Un
  // reintento inmediato cubre el fallo transitorio; si aun así falla, se alerta
  // CON el id — la fila queda 'processing' sin id (guard stale la corta) y el
  // staff debe verificar/asentar con el id del mensaje, no re-crear. Jamás
  // releaseClaim acá: volvería la fila a pending sin id -> re-POST -> doble refund.
  let persisted = false;
  try {
    await markProcessing(db, refund.id, result.externalRefundId, attempts);
    persisted = true;
  } catch {
    try {
      await markProcessing(db, refund.id, result.externalRefundId, attempts);
      persisted = true;
    } catch {
      alertRefund(
        'refund-mark-processing-failed',
        refund.id,
        `[process-refunds] POST ok pero no se persistió external_refund_id=${result.externalRefundId}; NO re-crear sin verificar`,
      );
    }
  }
  if (!persisted) return;

  // Algunos refunds resuelven sincrónico en el POST.
  if (result.status !== 'pending') {
    await settle(db, { ...refund, attempts }, result.status, result.failureReason);
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

// Alerta agregada a Sentry (una issue por fingerprint, nivel error: acción manual).
function alertRefund(fingerprint: string, refundId: string, message: string): void {
  Sentry.withScope((scope) => {
    scope.setLevel('error');
    scope.setFingerprint([fingerprint]);
    scope.setExtra('refundId', refundId);
    Sentry.captureMessage(message);
  });
}
