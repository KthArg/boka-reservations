import { describe, it, expect, beforeAll } from 'vitest';
import { INVITE_SET_TTL_MS } from '@shared/constants/users';
import { signInviteSet, verifyInviteSet } from './invite-set-token';

describe('invite-set-token', () => {
  beforeAll(() => {
    process.env.INVITE_SIGNING_SECRET ??= 'test-invite-secret-key';
  });

  const uid = '11111111-1111-1111-1111-111111111111';

  it('verifies a freshly signed token and returns its uid', () => {
    expect(verifyInviteSet(signInviteSet(uid))).toBe(uid);
  });

  it('rejects a token whose signature was tampered', () => {
    const token = signInviteSet(uid);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyInviteSet(tampered)).toBeNull();
  });

  it('rejects a token whose uid was swapped (signature no longer matches)', () => {
    const token = signInviteSet(uid);
    const [, exp, sig] = token.split('.');
    const forged = `22222222-2222-2222-2222-222222222222.${exp}.${sig}`;
    expect(verifyInviteSet(forged)).toBeNull();
  });

  it('rejects an expired token', () => {
    const past = Date.now() - INVITE_SET_TTL_MS - 1000;
    const token = signInviteSet(uid, past);
    expect(verifyInviteSet(token)).toBeNull();
  });

  it('rejects a token signed with a different secret (uses the dedicated INVITE_SIGNING_SECRET)', () => {
    const token = signInviteSet(uid);
    const original = process.env.INVITE_SIGNING_SECRET;
    process.env.INVITE_SIGNING_SECRET = 'a-completely-different-secret';
    try {
      expect(verifyInviteSet(token)).toBeNull();
    } finally {
      process.env.INVITE_SIGNING_SECRET = original;
    }
  });

  it('returns null for missing or malformed tokens', () => {
    expect(verifyInviteSet(undefined)).toBeNull();
    expect(verifyInviteSet('')).toBeNull();
    expect(verifyInviteSet('not-a-valid-token')).toBeNull();
  });
});
