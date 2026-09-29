import { describe, expect, it } from 'vitest';
import { UserManagementError } from '@shared/constants/users';
import { emailErrorFor, isAuthUserMissing } from './auth-errors';

describe('emailErrorFor', () => {
  it('un envío frenado por Supabase pide esperar', () => {
    expect(emailErrorFor({ code: 'over_email_send_rate_limit', status: 429 })).toBe(
      UserManagementError.InviteRateLimited,
    );
  });

  it('cualquier otra falla es el error genérico de envío', () => {
    expect(emailErrorFor({ code: 'email_exists', status: 422 })).toBe(
      UserManagementError.InviteFailed,
    );
    expect(emailErrorFor(null)).toBe(UserManagementError.InviteFailed);
  });
});

describe('isAuthUserMissing', () => {
  it('reconoce la cuenta inexistente por código o por 404', () => {
    expect(isAuthUserMissing({ code: 'user_not_found' })).toBe(true);
    expect(isAuthUserMissing({ status: 404 })).toBe(true);
    expect(isAuthUserMissing({ status: 500 })).toBe(false);
  });
});
