import { describe, it, expect } from 'vitest';
import { isSessionMismatch } from './guard';

describe('isSessionMismatch', () => {
  it('rejects when the link uid does not match the active session user', () => {
    // admin logueado abre el enlace de invitación de otro usuario
    expect(isSessionMismatch('invited-user-id', 'admin-user-id')).toBe(true);
  });

  it('allows when the session user matches the link uid', () => {
    expect(isSessionMismatch('user-1', 'user-1')).toBe(false);
  });

  it('rejects when there is a uid but no active session', () => {
    expect(isSessionMismatch('user-1', undefined)).toBe(true);
  });

  it('does not apply the guard when no uid is present (legacy forgot-password)', () => {
    expect(isSessionMismatch(null, 'user-1')).toBe(false);
    expect(isSessionMismatch('', 'user-1')).toBe(false);
  });

  it('does not apply the guard for a non-string form value', () => {
    expect(isSessionMismatch(new File([], 'x'), 'user-1')).toBe(false);
  });
});
