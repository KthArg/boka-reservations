import { UserManagementError } from '@shared/constants/users';

/** Código de Supabase Auth cuando se frena un envío: intervalo por persona o límite por hora. */
const EMAIL_RATE_LIMIT_CODE = 'over_email_send_rate_limit';
/** Código de Supabase Auth cuando la cuenta no existe. */
const USER_NOT_FOUND_CODE = 'user_not_found';
const NOT_FOUND_STATUS = 404;

type AuthErrorLike = { code?: string; status?: number } | null | undefined;

/** Un correo de Auth que falló, en el error que ve el admin (spec 0038). */
export function emailErrorFor(error: AuthErrorLike): UserManagementError {
  return error?.code === EMAIL_RATE_LIMIT_CODE
    ? UserManagementError.InviteRateLimited
    : UserManagementError.InviteFailed;
}

/** La cuenta de acceso no existe (se borró fuera del panel). */
export function isAuthUserMissing(error: AuthErrorLike): boolean {
  return error?.code === USER_NOT_FOUND_CODE || error?.status === NOT_FOUND_STATUS;
}
