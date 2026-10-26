import { describe, expect, it } from 'vitest';
import { mfaDestination } from './mfa-destination';

describe('mfaDestination', () => {
  it('keeps a safe page of the panel', () => {
    expect(mfaDestination('/es/dashboard/users', 'es')).toBe('/es/dashboard/users');
  });

  it.each([undefined, '//evil.com', 'https://evil.com', '/es/mfa', '/es/mfa?redirectTo=/es/mfa'])(
    'falls back to the dashboard for %j',
    (value) => {
      expect(mfaDestination(value, 'es')).toBe('/es/dashboard');
    },
  );
});
