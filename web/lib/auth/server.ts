import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import type { Tables } from '@/types/database';
import { UserRole } from '@shared/constants/enums';
import type { User } from '@supabase/supabase-js';

export type AuthUser = User & { userRole: UserRole | undefined };

export class AuthError extends Error {
  constructor(public readonly code: 'UNAUTHENTICATED' | 'UNAUTHORIZED' | 'ACCOUNT_INACTIVE') {
    super(code);
  }
}

function decodeUserRole(accessToken: string): UserRole | undefined {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
    return payload.user_role as UserRole | undefined;
  } catch {
    return undefined;
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
  const userRole = session ? decodeUserRole(session.access_token) : undefined;

  return { ...user, userRole };
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

  const dbUser = await getCurrentUser();
  if (!dbUser?.active) throw new AuthError('ACCOUNT_INACTIVE');

  return user;
}

export async function requireRole(role: UserRole): Promise<AuthUser> {
  const user = await requireAuth();
  if (user.userRole !== role) throw new AuthError('UNAUTHORIZED');
  return user;
}
