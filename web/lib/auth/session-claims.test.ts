import { describe, expect, it } from 'vitest';
import { decodeSessionClaims, needsSecondFactor } from './session-claims';

function token(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${body}.signature`;
}

describe('decodeSessionClaims', () => {
  it('reads the role from the hook and the authentication level', () => {
    expect(decodeSessionClaims(token({ user_role: 'staff', aal: 'aal2' }))).toEqual({
      userRole: 'staff',
      aal: 'aal2',
    });
  });

  it('fails closed on a malformed token', () => {
    expect(decodeSessionClaims('not-a-jwt')).toEqual({ userRole: undefined, aal: undefined });
  });
});

describe('needsSecondFactor', () => {
  it.each([
    ['admin', 'aal1', true],
    ['staff', 'aal1', true],
    ['staff', undefined, true],
    ['admin', 'aal2', false],
    ['staff', 'aal2', false],
    [undefined, 'aal1', false],
  ])('role %s with %s → %s', (userRole, aal, expected) => {
    expect(needsSecondFactor({ userRole, aal })).toBe(expected);
  });
});
