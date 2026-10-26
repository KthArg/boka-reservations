import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import type { Tables } from '@/types/database';
import { UserRole } from '@shared/constants/enums';
import type { User } from '@supabase/supabase-js';
import { decodeSessionClaims, needsSecondFactor } from './session-claims';

export type AuthUser = User & { userRole: UserRole | undefined; aal: string | undefined };

export type AuthErrorCode =
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'ACCOUNT_INACTIVE'
  /** Usuario del panel cuya sesión no verificó el segundo factor (spec 0049). */
  | 'MFA_REQUIRED';

/** Usuario del panel sin el segundo factor verificado en esta sesión (spec 0049). */
export const MFA_REQUIRED: AuthErrorCode = 'MFA_REQUIRED';

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode) {
    super(code);
  }
}

export async function getSession(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const claims = session ? decodeSessionClaims(session.access_token) : undefined;

  return { ...user, userRole: claims?.userRole as UserRole | undefined, aal: claims?.aal };
}

export async function getCurrentUser(): Promise<Tables<'users'> | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from('users').select('*').eq('id', user.id).single();

  return data;
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getSession();
  if (!user) throw new AuthError('UNAUTHENTICATED');

  // Antes de leer `users`: con la RLS de …064, una sesión aal1 del panel no ve su propia fila y
  // fallaría como cuenta inactiva en vez de ir a /mfa (spec 0049 §5.1).
  if (needsSecondFactor({ userRole: user.userRole, aal: user.aal })) {
    throw new AuthError(MFA_REQUIRED);
  }

  const dbUser = await getCurrentUser();
  if (!dbUser?.active) throw new AuthError('ACCOUNT_INACTIVE');

  return user;
}

export async function requireRole(role: UserRole): Promise<AuthUser> {
  const user = await requireAuth();
  if (user.userRole !== role) throw new AuthError('UNAUTHORIZED');
  return user;
}

export async function requireAnyRole(roles: readonly UserRole[]): Promise<AuthUser> {
  const user = await requireAuth();
  if (!user.userRole || !roles.includes(user.userRole)) throw new AuthError('UNAUTHORIZED');
  return user;
}

/**
 * Guard de /mfa (spec 0049): sesión de admin o staff según el JWT, con o sin segundo factor. No lee
 * tablas con RLS (una sesión aal1 no las ve) y no revisa `active`: el custom_access_token_hook ya
 * le niega el token a un usuario desactivado.
 */
export async function requirePanelSessionForMfa(): Promise<AuthUser> {
  const user = await getSession();
  if (!user) throw new AuthError('UNAUTHENTICATED');
  if (user.userRole !== UserRole.Admin && user.userRole !== UserRole.Staff) {
    throw new AuthError('UNAUTHORIZED');
  }
  return user;
}
