import { describe, expect, it } from 'vitest';
import { generateNonce } from './nonce';

const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
const NONCE_BYTES = 16;

describe('generateNonce', () => {
  it('devuelve un string base64 no vacío', () => {
    const nonce = generateNonce();
    expect(nonce.length).toBeGreaterThan(0);
    expect(nonce).toMatch(BASE64_RE);
  });

  it('codifica 16 bytes (edge-safe, sin Buffer)', () => {
    // atob revierte el btoa del generador; debe dar exactamente 16 bytes.
    expect(atob(generateNonce()).length).toBe(NONCE_BYTES);
  });

  it('produce un valor distinto en cada llamada', () => {
    const values = new Set(Array.from({ length: 100 }, () => generateNonce()));
    expect(values.size).toBe(100);
  });
});
