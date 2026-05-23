import { describe, it, expect } from 'vitest';

describe('smoke test — worker', () => {
  it('entorno node está disponible', () => {
    expect(typeof process.env).toBe('object');
  });

  it('intervalos de tiempo son constantes numerables', () => {
    const ALIVE_INTERVAL_MS = 30_000;
    expect(ALIVE_INTERVAL_MS).toBe(30000);
    expect(typeof ALIVE_INTERVAL_MS).toBe('number');
  });
});
