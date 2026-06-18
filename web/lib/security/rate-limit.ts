import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { env } from '@/lib/env';

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

const DISABLED = 'false';
const KEY_PREFIX_PARTS = 2;

/**
 * Chequea (y consume) un intento contra la ventana del límite identificado por `key`.
 * El estado es compartido entre lambdas serverless: vive en Postgres (función
 * `check_rate_limit`, atómica). El caller decide qué hacer con el resultado.
 *
 * - **Kill-switch**: si `RATE_LIMIT_ENABLED='false'`, no limita (deja pasar todo).
 * - **Fail-open**: si el store falla, deja pasar y alerta en Sentry. Con Postgres como
 *   store, si está caído login/checkout ya no funcionan por otras razones; bloquear sólo
 *   sumaría un modo de falla sin beneficio (spec 0017 §8).
 * - **Observabilidad**: cada "excedido" se registra (warning) agrupado por prefijo de la
 *   clave, sin PII (la identidad ya viaja hasheada en la clave).
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (env.RATE_LIMIT_ENABLED === DISABLED) return { ok: true };

  try {
    const db = createSupabaseServiceClient();
    const { data, error } = await db.rpc('check_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error || !data || data.length === 0) {
      return failOpen(key, error?.message ?? 'respuesta vacía del store');
    }
    const { allowed, retry_after: retryAfter } = data[0];
    if (allowed) return { ok: true };
    logExceeded(key);
    return { ok: false, retryAfter };
  } catch (err) {
    return failOpen(key, err instanceof Error ? err.message : 'error desconocido');
  }
}

function keyPrefix(key: string): string {
  return key.split(':').slice(0, KEY_PREFIX_PARTS).join(':');
}

function logExceeded(key: string): void {
  const prefix = keyPrefix(key);
  console.warn(`[rate-limit] excedido — ${prefix}`);
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setFingerprint(['rate-limit-exceeded', prefix]);
    scope.setExtra('keyPrefix', prefix);
    Sentry.captureMessage('[rate-limit] límite excedido');
  });
}

function failOpen(key: string, reason: string): RateLimitResult {
  const prefix = keyPrefix(key);
  console.error(`[rate-limit] store no disponible (fail-open) — ${prefix}: ${reason}`);
  Sentry.withScope((scope) => {
    scope.setLevel('error');
    scope.setFingerprint(['rate-limit-store-unavailable']);
    scope.setExtra('keyPrefix', prefix);
    scope.setExtra('reason', reason);
    Sentry.captureMessage('[rate-limit] store no disponible — fail-open');
  });
  return { ok: true };
}
