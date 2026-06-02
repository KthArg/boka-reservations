import { describe, it, expect } from 'vitest';
import { UserRole } from '@shared/constants/enums';
import { UserManagementError } from '@shared/constants/users';
import { checkDeactivation } from './guards';

describe('checkDeactivation', () => {
  const base = {
    targetId: 'user-1',
    targetRole: UserRole.Staff,
    targetActive: true,
    currentUserId: 'admin-1',
    activeAdminCount: 2,
  };

  it('rejects deactivating yourself', () => {
    const result = checkDeactivation({ ...base, targetId: 'admin-1', currentUserId: 'admin-1' });
    expect(result).toBe(UserManagementError.SelfDeactivation);
  });

  it('rejects deactivating the last active admin', () => {
    const result = checkDeactivation({
      ...base,
      targetId: 'admin-2',
      targetRole: UserRole.Admin,
      activeAdminCount: 1,
    });
    expect(result).toBe(UserManagementError.LastAdmin);
  });

  it('allows deactivating an admin when others remain active', () => {
    const result = checkDeactivation({
      ...base,
      targetId: 'admin-2',
      targetRole: UserRole.Admin,
      activeAdminCount: 2,
    });
    expect(result).toBeNull();
  });

  it('allows deactivating a staff member', () => {
    expect(checkDeactivation(base)).toBeNull();
  });

  it('does not treat an already-inactive admin as the last active one', () => {
    const result = checkDeactivation({
      ...base,
      targetId: 'admin-2',
      targetRole: UserRole.Admin,
      targetActive: false,
      activeAdminCount: 1,
    });
    expect(result).toBeNull();
  });
});
