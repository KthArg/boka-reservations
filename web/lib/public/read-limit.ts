import 'server-only';
import { headers } from 'next/headers';
import { RATE_LIMITS, RATE_LIMIT_KEY_PREFIX } from '@shared/constants/rate-limit';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';
import { rateLimitKey } from '@/lib/security/rate-limit-key';

/**
 * INFRA-05 (spec 0023): límite holgado por IP a las lecturas públicas del portal
 * (browsing de tours), como freno anti-scraping.
 *
 * Los reads son idempotentes y no tocan inventario, por eso el umbral es muy alto:
 * no afecta a usuarios legítimos ni a IPs compartidas (NAT/CGNAT) y sólo corta
 * raspados masivos. Comparte el kill-switch (RATE_LIMIT_ENABLED) y el fail-open de
 * `checkRateLimit`, así que ante un fallo del store deja pasar. Devuelve `true` cuando
 * la petición debe frenarse; el caller renderiza un aviso suave en vez del contenido.
 */
export async function isPublicReadThrottled(): Promise<boolean> {
  const ip = getClientIp(await headers());
  const result = await checkRateLimit(
    rateLimitKey(RATE_LIMIT_KEY_PREFIX.publicReadIp, ip),
    RATE_LIMITS.publicReadPerIp.limit,
    RATE_LIMITS.publicReadPerIp.windowSeconds,
  );
  return !result.ok;
}
