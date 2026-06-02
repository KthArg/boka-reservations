import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { UserRole } from '@shared/constants/enums';
import type { UserFilters, UserListItem } from './types';

const LIST_SELECT = 'id, email, role, full_name, phone, active, locale';

/** Usuarios internos ordenados por nombre, con filtros opcionales por rol y estado. */
export async function listUsers(filters: UserFilters = {}): Promise<UserListItem[]> {
  const sb = await createSupabaseServerClient();
  let q = sb.from('users').select(LIST_SELECT);
  if (filters.role) q = q.eq('role', filters.role);
  if (filters.active !== undefined) q = q.eq('active', filters.active);
  const { data, error } = await q.order('full_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as UserListItem[];
}

export async function getUserById(id: string): Promise<UserListItem | null> {
  const sb = await createSupabaseServerClient();
  const { data } = await sb.from('users').select(LIST_SELECT).eq('id', id).maybeSingle();
  return (data as UserListItem | null) ?? null;
}

/** True si ya existe un usuario con ese email en public.users (chequeo previo al alta). */
export async function emailExists(email: string): Promise<boolean> {
  const sb = await createSupabaseServerClient();
  const { data } = await sb.from('users').select('id').eq('email', email).maybeSingle();
  return data !== null;
}

export async function countActiveAdmins(): Promise<number> {
  const sb = await createSupabaseServerClient();
  const { count, error } = await sb
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', UserRole.Admin)
    .eq('active', true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
