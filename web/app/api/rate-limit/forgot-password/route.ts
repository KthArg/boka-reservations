import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';
import { rateLimitKey } from '@/lib/security/rate-limit-key';
import { RATE_LIMITS, RATE_LIMIT_KEY_PREFIX } from '@shared/constants/rate-limit';

const BodySchema = z.object({ email: z.string().email() });

/**
 * Rate limit propio para forgot-password, llamado por el form ANTES del PKCE (spec 0017,
 * §5.3 opción a). `resetPasswordForEmail` debe salir del browser (lo exige PKCE), así que
 * el límite no puede ir en un Server Action; este route handler da control por email
 * (hash) además de por IP. En 429 el form NO llama a Supabase y muestra la misma respuesta
 * neutra que en el caso exitoso (anti-enumeración). El fail-open ante caída del store lo
 * maneja checkRateLimit.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const ip = getClientIp(req.headers.get('x-forwarded-for'));
  const [byIp, byEmail] = await Promise.all([
    checkRateLimit(
      rateLimitKey(RATE_LIMIT_KEY_PREFIX.forgotIp, ip),
      RATE_LIMITS.forgotPerIp.limit,
      RATE_LIMITS.forgotPerIp.windowSeconds,
    ),
    checkRateLimit(
      rateLimitKey(RATE_LIMIT_KEY_PREFIX.forgotEmail, body.data.email),
      RATE_LIMITS.forgotPerEmail.limit,
      RATE_LIMITS.forgotPerEmail.windowSeconds,
    ),
  ]);

  if (byIp.ok && byEmail.ok) {
    return NextResponse.json({ ok: true });
  }

  const retryAfter = Math.max(byIp.ok ? 0 : byIp.retryAfter, byEmail.ok ? 0 : byEmail.retryAfter);
  return NextResponse.json(
    { ok: false },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}
