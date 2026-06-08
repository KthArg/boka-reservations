import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashGuideToken } from './hash';

describe('hashGuideToken', () => {
  it('produce el sha256 hex del token (mismo algoritmo que el worker)', () => {
    const expected = createHash('sha256').update('magic-abc').digest('hex');
    expect(hashGuideToken('magic-abc')).toBe(expected);
  });

  it('es determinístico', () => {
    expect(hashGuideToken('t')).toBe(hashGuideToken('t'));
  });

  it('produce hashes distintos para tokens distintos', () => {
    expect(hashGuideToken('a')).not.toBe(hashGuideToken('b'));
  });
});
