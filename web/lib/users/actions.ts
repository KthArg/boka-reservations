'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { requireRole, type AuthUser } from '@/lib/auth/server';
import { UserRole } from '@shared/constants/enums';
import { UserManagementError } from '@shared/constants/users';
import { UserCreateSchema, UserUpdateSchema } from '@shared/schemas';
import { createInternalUser } from './create';
import { resendInvite as resendInviteService, setUserActive, updateInternalUser } from './manage';
import { emailExists } from './repository';
import type { FieldErrors, FormResult, UserActionResult } from './types';

const USERS_PATH = '/dashboard/users';

function requireAdmin(): Promise<AuthUser | null> {
  return requireRole(UserRole.Admin).catch(() => null);
}

function fieldErrors(errors: FieldErrors): FormResult {
  return { success: false, errors };
}

export async function createUser(
  _prev: FormResult | null,
  formData: FormData,
): Promise<FormResult> {
  const admin = await requireAdmin();
  if (!admin) return fieldErrors({ _form: [UserManagementError.Unauthorized] });

  const parsed = UserCreateSchema.safeParse({
    email: formData.get('email'),
    full_name: formData.get('full_name'),
    role: formData.get('role'),
    phone: formData.get('phone'),
    locale: formData.get('locale'),
  });
  if (!parsed.success) return fieldErrors(parsed.error.flatten().fieldErrors as FieldErrors);

  if (await emailExists(parsed.data.email)) {
    return fieldErrors({ email: [UserManagementError.EmailTaken] });
  }

  const locale = await getLocale();
  const result = await createInternalUser(parsed.data, locale);
  if (!result.ok) return fieldErrors({ _form: [result.error] });

  revalidatePath(USERS_PATH);
  redirect(`/${locale}/dashboard/users`);
}

export async function updateUser(
  id: string,
  _prev: FormResult | null,
  formData: FormData,
): Promise<FormResult> {
  const admin = await requireAdmin();
  if (!admin) return fieldErrors({ _form: [UserManagementError.Unauthorized] });

  const parsed = UserUpdateSchema.safeParse({
    full_name: formData.get('full_name'),
    phone: formData.get('phone'),
    locale: formData.get('locale'),
  });
  if (!parsed.success) return fieldErrors(parsed.error.flatten().fieldErrors as FieldErrors);

  const result = await updateInternalUser(id, parsed.data);
  if (!result.ok) return fieldErrors({ _form: [result.error] });

  const locale = await getLocale();
  revalidatePath(USERS_PATH);
  redirect(`/${locale}/dashboard/users`);
}

export async function setActive(id: string, active: boolean): Promise<UserActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: UserManagementError.Unauthorized };
  const result = await setUserActive(id, active, admin.id);
  if (result.ok) revalidatePath(USERS_PATH);
  return result;
}

export async function resendInvite(id: string): Promise<UserActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: UserManagementError.Unauthorized };
  const locale = await getLocale();
  return resendInviteService(id, locale);
}
