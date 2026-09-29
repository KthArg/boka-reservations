import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserManagementError } from '@shared/constants/users';

vi.mock('server-only', () => ({}));

const getUserById = vi.fn();
const update = vi.fn();
vi.mock('@/lib/db/supabase-service', () => ({
  createSupabaseServiceClient: () => ({
    auth: { admin: { getUserById, updateUserById: vi.fn() } },
    from: () => ({ update }),
  }),
}));

const findUser = vi.fn();
vi.mock('./repository', () => ({ getUserById: findUser, countActiveAdmins: vi.fn() }));

const { setUserActive } = await import('./manage');

beforeEach(() => {
  vi.clearAllMocks();
  findUser.mockResolvedValue({ id: 'u-1', role: 'staff', active: false });
});

describe('setUserActive — reactivar (spec 0038)', () => {
  it('si la cuenta de acceso ya no existe, avisa y no escribe', async () => {
    getUserById.mockResolvedValue({
      data: { user: null },
      error: { code: 'user_not_found', status: 404 },
    });

    const result = await setUserActive('u-1', true, 'admin-1');

    expect(result).toEqual({ ok: false, error: UserManagementError.AccountMissing });
    expect(update).not.toHaveBeenCalled();
  });
});
