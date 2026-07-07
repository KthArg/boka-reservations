import 'server-only';
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';
import { rateLimitKey } from '@/lib/security/rate-limit-key';
import { RATE_LIMITS, RATE_LIMIT_KEY_PREFIX } from '@shared/constants/rate-limit';

/**
 * Throttle por IP de la validación de magic links (spec 0028, B10): la convención del
 * repo exige rate limiting en "validar magic link" y estos endpoints exponen PII y
 * permiten cancelar. Excedido → el caller responde EXACTAMENTE igual que ante un token
 * inválido (sin oráculo). Comparte el store Postgres del 0017 (respeta el kill-switch
 * RATE_LIMIT_ENABLED).
 */
export async function isMagicLinkThrottled(): Promise<boolean> {
  try {
    const ip = getClientIp(await headers());
    const result = await checkRateLimit(
      rateLimitKey(RATE_LIMIT_KEY_PREFIX.magicLinkIp, ip),
      RATE_LIMITS.magicLinkPerIp.limit,
      RATE_LIMITS.magicLinkPerIp.windowSeconds,
    );
    return !result.ok;
  } catch {
    // Sin request context (tests que llaman el validador directo) o fallo del store:
    // fail-open — el throttle es anti-abuso, no la barrera de seguridad (esa es la
    // entropía del token).
    return false;
  }
}
