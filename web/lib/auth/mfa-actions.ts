'use server';

import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { writeAuditLog } from '@/lib/audit/log';
import { requirePanelSessionForMfa } from '@/lib/auth/server';
import { mfaDestination } from '@/lib/auth/mfa-destination';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { rateLimitKey } from '@/lib/security/rate-limit-key';
import { AuditAction, AuditEntityType, actorTypeForRole } from '@shared/constants/audit';
import { UserRole } from '@shared/constants/enums';
import { RATE_LIMITS, RATE_LIMIT_KEY_PREFIX } from '@shared/constants/rate-limit';
import { FACTOR_VERIFIED, MfaError, type MfaEnrollment, type MfaVerifyState } from './mfa-types';

// Segundo factor del panel (spec 0049 §5.1). Corren en el servidor con la sesión aal1 del usuario:
// `verify` pasa por acá para que valga el límite propio por usuario.

const TOTP = 'totp';
const VERIFIED = FACTOR_VERIFIED;

const VerifySchema = z.object({
  factorId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  redirectTo: z.string().optional(),
});

async function sessionOrNull() {
  return requirePanelSessionForMfa().catch(() => null);
}

/**
 * Enrolamiento: borra los factores TOTP sin verificar de un intento anterior y crea uno nuevo. Si
 * ya hay uno verificado, no enrola (GoTrue lo rechazaría con aal1) y la página pasa a desafío.
 */
export async function startMfaEnrollmentAction(): Promise<MfaEnrollment> {
  if (!(await sessionOrNull())) return { ok: false, error: MfaError.SessionExpired };
  const supabase = await createSupabaseServerClient();

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { ok: false, error: MfaError.Generic };
  if (factors.totp.some((f) => f.status === VERIFIED))
    return { ok: false, error: MfaError.HasFactor };
  for (const stale of factors.all.filter((f) => f.factor_type === TOTP && f.status !== VERIFIED)) {
    // Sin chequear, los factores sin verificar se acumularían hasta el máximo de Supabase y el
    // enrolamiento fallaría sin explicación.
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: stale.id });
    if (unenrollError) {
      console.error('[mfa] unenroll:', unenrollError.code);
      return { ok: false, error: MfaError.Generic };
    }
  }

  // Nombre único por intento: dos pestañas no chocan con `mfa_factor_name_conflict`.
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: TOTP,
    friendlyName: `Boka Verde ${new Date().toISOString()}`,
  });
  if (error) {
    console.error('[mfa] enroll:', error.code);
    return { ok: false, error: MfaError.Generic };
  }
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyMfaAction(
  _prev: MfaVerifyState,
  formData: FormData,
): Promise<MfaVerifyState> {
  const user = await sessionOrNull();
  if (!user) return { error: MfaError.SessionExpired };

  const parsed = VerifySchema.safeParse({
    factorId: formData.get('factorId'),
    code: String(formData.get('code') ?? '').replace(/\s/g, ''),
    redirectTo: formData.get('redirectTo') || undefined,
  });
  if (!parsed.success) return { error: MfaError.InvalidCode };

  const limit = await checkRateLimit(
    rateLimitKey(RATE_LIMIT_KEY_PREFIX.mfaVerifyUser, user.id),
    RATE_LIMITS.mfaVerifyPerUser.limit,
    RATE_LIMITS.mfaVerifyPerUser.windowSeconds,
  );
  if (!limit.ok) return { error: MfaError.TooManyAttempts };

  const supabase = await createSupabaseServerClient();
  // El factor tiene que ser de este usuario: listFactors solo devuelve los propios.
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    console.error('[mfa] listFactors:', listError.code);
    return { error: MfaError.Generic };
  }
  const factor = factors.all.find((f) => f.id === parsed.data.factorId);
  if (!factor) return { error: MfaError.SessionExpired };
  const enrolling = factor.status !== VERIFIED;

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: parsed.data.code,
  });
  if (error) return { error: MfaError.InvalidCode };

  if (enrolling) {
    await writeAuditLog(createSupabaseServiceClient(), {
      actorType: actorTypeForRole(user.userRole as UserRole),
      actorId: user.id,
      action: AuditAction.UserMfaEnrolled,
      entityType: AuditEntityType.User,
      entityId: user.id,
    });
  }

  const locale = await getLocale();
  redirect(mfaDestination(parsed.data.redirectTo, locale));
}
