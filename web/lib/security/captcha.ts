import 'server-only';
import { headers } from 'next/headers';
import { env, isTurnstileTestSecret } from '@/lib/env';
import { captureAlert } from '@/lib/booking/sentry-alert';
import { getClientIp } from '@/lib/security/client-ip';
import { UNKNOWN_IP } from '@shared/constants/rate-limit';
import type { CaptchaActionValue } from '@shared/constants/captcha';

// Verificación del captcha del checkout con Cloudflare Turnstile (spec 0048 §5.4). Falla cerrado:
// sin respuesta de Cloudflare no se aparta cupo (decisión del operador, 2026-10-20).

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5_000;
/** Largo máximo de un token según Cloudflare; uno más largo no se manda a verificar. */
const MAX_TOKEN_LENGTH = 2048;
/** Cloudflare pide reintentar ante este código: es un problema suyo, no del turista. */
const INTERNAL_ERROR = 'internal-error';
/** Secreto mal cargado o rotado: con estos, todos los pasos 1 fallan hasta corregir la variable. */
const SECRET_ERRORS = ['missing-input-secret', 'invalid-input-secret'];

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
  metadata?: { result_with_testing_key?: boolean };
};

export function isCaptchaEnabled(): boolean {
  return env.CAPTCHA_ENABLED === 'true';
}

/** La sitekey para el widget, o null con el captcha apagado (el widget no se renderiza). */
export function captchaSiteKey(): string | null {
  return isCaptchaEnabled() ? (env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null) : null;
}

function allowedHostnames(): string[] {
  return (env.TURNSTILE_ALLOWED_HOSTNAMES ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

function alertUnavailable(reason: string): void {
  captureAlert('[captcha] Cloudflare no verificó el captcha', 'captcha-siteverify-unavailable', {
    reason,
  });
}

/** Configuración del captcha que rechaza a todos los turistas: no es un error de ellos. */
function alertMisconfigured(reason: string, extras: Record<string, string> = {}): void {
  captureAlert(
    '[captcha] configuración inválida',
    'captcha-misconfigured',
    { reason, ...extras },
    'error',
  );
}

async function siteverify(secret: string, token: string): Promise<SiteverifyResponse | null> {
  const body = new URLSearchParams({ secret, response: token });
  const ip = getClientIp(await headers());
  if (ip !== UNKNOWN_IP) body.set('remoteip', ip);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      alertUnavailable(`http-${res.status}`);
      return null;
    }
    return (await res.json()) as SiteverifyResponse;
  } catch (err) {
    alertUnavailable(err instanceof Error ? err.name : 'unknown');
    return null;
  }
}

/**
 * `true` si el captcha está apagado o si Cloudflare confirma el token para este sitio y esta
 * acción. El token es de un solo uso y vence a los 300 s: uno vencido o repetido da `false`.
 */
export async function verifyCaptcha(
  token: string | null,
  action: CaptchaActionValue,
): Promise<boolean> {
  if (!isCaptchaEnabled()) return true;
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret || !token || token.length > MAX_TOKEN_LENGTH) return false;

  const result = await siteverify(secret, token);
  if (!result) return false;
  const codes = result['error-codes'] ?? [];
  if (codes.includes(INTERNAL_ERROR)) alertUnavailable(INTERNAL_ERROR);
  const secretError = codes.find((code) => SECRET_ERRORS.includes(code));
  if (secretError) alertMisconfigured(secretError);
  if (result.success !== true) return false;

  // Las llaves de prueba (local y CI) responden con hostname `example.com` y sin acción.
  if (result.metadata?.result_with_testing_key === true) return isTurnstileTestSecret(secret);

  // Un hostname fuera de la lista con `success` es un dominio nuevo o la variable mal escrita, o un
  // token resuelto en otro sitio: se rechaza igual, pero se avisa para no bloquear en silencio.
  if (result.hostname === undefined || !allowedHostnames().includes(result.hostname)) {
    alertMisconfigured('hostname', { hostname: result.hostname ?? '' });
    return false;
  }
  return result.action === action;
}
