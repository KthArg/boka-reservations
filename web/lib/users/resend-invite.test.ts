import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserManagementError } from '@shared/constants/users';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { APP_URL: 'https://reservas.example.com' } }));

const getUserById = vi.fn();
const inviteUserByEmail = vi.fn();
const resetPasswordForEmail = vi.fn();
vi.mock('@/lib/db/supabase-service', () => ({
  createSupabaseServiceClient: () => ({
    auth: { admin: { getUserById, inviteUserByEmail }, resetPasswordForEmail },
  }),
}));

const findUser = vi.fn();
vi.mock('./repository', () => ({ getUserById: findUser }));

const { resendInvite } = await import('./resend-invite');

const STAFF = {
  id: 'u-1',
  email: 'staff@example.com',
  role: 'staff',
  full_name: 'Staff',
  locale: 'es',
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  findUser.mockResolvedValue(STAFF);
  inviteUserByEmail.mockResolvedValue({ error: null });
  resetPasswordForEmail.mockResolvedValue({ error: null });
});

function account(emailConfirmedAt: string | null) {
  getUserById.mockResolvedValue({
    data: { user: { id: 'u-1', email: STAFF.email, email_confirmed_at: emailConfirmedAt } },
    error: null,
  });
}

describe('resendInvite (spec 0038)', () => {
  it('a una cuenta sin confirmar le reenvía la invitación', async () => {
    account(null);
    expect(await resendInvite('u-1', 'es')).toEqual({ ok: true, sent: 'invite' });
    expect(inviteUserByEmail).toHaveBeenCalledOnce();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('a una cuenta confirmada le manda el correo para fijar la contraseña', async () => {
    account('2026-09-28T19:10:14Z');
    expect(await resendInvite('u-1', 'es')).toEqual({ ok: true, sent: 'password' });
    expect(resetPasswordForEmail).toHaveBeenCalledWith(STAFF.email);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('sin cuenta de acceso no invita: pide invitar de nuevo', async () => {
    getUserById.mockResolvedValue({
      data: { user: null },
      error: { code: 'user_not_found', status: 404 },
    });
    expect(await resendInvite('u-1', 'es')).toEqual({
      ok: false,
      error: UserManagementError.AccountMissing,
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('si no puede leer la cuenta, error genérico', async () => {
    getUserById.mockResolvedValue({
      data: { user: null },
      error: { code: 'unexpected', status: 500 },
    });
    expect(await resendInvite('u-1', 'es')).toEqual({
      ok: false,
      error: UserManagementError.InviteFailed,
    });
  });

  it('un envío frenado por Supabase pide esperar', async () => {
    account('2026-09-28T19:10:14Z');
    resetPasswordForEmail.mockResolvedValue({
      error: { code: 'over_email_send_rate_limit', status: 429 },
    });
    expect(await resendInvite('u-1', 'es')).toEqual({
      ok: false,
      error: UserManagementError.InviteRateLimited,
    });
  });

  it('a un usuario desactivado no le manda nada', async () => {
    findUser.mockResolvedValue({ ...STAFF, active: false });
    expect(await resendInvite('u-1', 'es')).toEqual({
      ok: false,
      error: UserManagementError.InviteFailed,
    });
    expect(getUserById).not.toHaveBeenCalled();
  });
});
