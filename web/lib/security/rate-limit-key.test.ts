import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashIdentifier, rateLimitKey } from './rate-limit-key';

const SHA256_HEX_LENGTH = 64;

describe('hashIdentifier', () => {
  it('es determinístico para el mismo valor', () => {
    expect(hashIdentifier('user@example.com')).toBe(hashIdentifier('user@example.com'));
  });

  it('normaliza mayúsculas y espacios (misma clave)', () => {
    expect(hashIdentifier('  User@Example.com ')).toBe(hashIdentifier('user@example.com'));
  });

  it('produce hashes distintos para identidades distintas', () => {
    expect(hashIdentifier('a@example.com')).not.toBe(hashIdentifier('b@example.com'));
  });

  it('devuelve SHA-256 en hex (64 chars) — no la PII en claro', () => {
    const hash = hashIdentifier('user@example.com');
    expect(hash).toHaveLength(SHA256_HEX_LENGTH);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash).not.toContain('user@example.com');
  });
});

describe('hashIdentifier — con clave (spec 0036)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('no coincide con el SHA-256 plano, que se revierte probando valores', () => {
    const plain = createHash('sha256').update('203.0.113.7').digest('hex');
    expect(hashIdentifier('203.0.113.7')).not.toBe(plain);
  });

  it('depende del secreto', () => {
    vi.stubEnv('IDENTIFIER_HASH_SECRET', 'secreto-a');
    const a = hashIdentifier('203.0.113.7');
    vi.stubEnv('IDENTIFIER_HASH_SECRET', 'secreto-b');
    expect(hashIdentifier('203.0.113.7')).not.toBe(a);
  });

  it('en producción no funciona sin secreto', () => {
    vi.stubEnv('IDENTIFIER_HASH_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => hashIdentifier('203.0.113.7')).toThrow('IDENTIFIER_HASH_SECRET');
  });
});

describe('rateLimitKey', () => {
  it('compone `<prefijo>:<hash>` y no incluye la identidad en claro', () => {
    const key = rateLimitKey('login:email', 'victim@example.com');
    expect(key).toBe(`login:email:${hashIdentifier('victim@example.com')}`);
    expect(key).not.toContain('victim@example.com');
  });
});
