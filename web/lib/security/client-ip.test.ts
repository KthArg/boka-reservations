import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClientIp } from './client-ip';
import { UNKNOWN_IP } from '@shared/constants/rate-limit';

function headers(map: Record<string, string>): { get(name: string): string | null } {
  return { get: (name) => map[name] ?? null };
}

describe('getClientIp', () => {
  it('toma el PRIMER elemento de x-forwarded-for (la IP real en Vercel)', () => {
    expect(
      getClientIp(headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' })),
    ).toBe('203.0.113.7');
  });

  it('hace trim del valor', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '  203.0.113.7  ' }))).toBe('203.0.113.7');
  });

  it('prefiere x-vercel-forwarded-for sobre x-forwarded-for', () => {
    expect(
      getClientIp(
        headers({ 'x-vercel-forwarded-for': '198.51.100.9', 'x-forwarded-for': '1.2.3.4' }),
      ),
    ).toBe('198.51.100.9');
  });

  it('usa x-real-ip cuando no hay x-vercel-forwarded-for, antes que x-forwarded-for', () => {
    expect(
      getClientIp(headers({ 'x-real-ip': '198.51.100.10', 'x-forwarded-for': '1.2.3.4' })),
    ).toBe('198.51.100.10');
  });

  it('ignora IPs spoofeadas que el cliente anteponga después de la real', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }))).toBe('1.2.3.4');
  });

  it('devuelve UNKNOWN_IP cuando no hay headers de IP', () => {
    expect(getClientIp(headers({}))).toBe(UNKNOWN_IP);
  });

  it('devuelve UNKNOWN_IP cuando el valor está vacío o es solo espacios', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '   ' }))).toBe(UNKNOWN_IP);
  });

  describe('en Vercel (VERCEL=1)', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('no confía en x-forwarded-for: sin headers de la plataforma devuelve UNKNOWN_IP', () => {
      vi.stubEnv('VERCEL', '1');
      expect(getClientIp(headers({ 'x-forwarded-for': '6.6.6.6' }))).toBe(UNKNOWN_IP);
    });

    it('sigue usando x-vercel-forwarded-for', () => {
      vi.stubEnv('VERCEL', '1');
      expect(
        getClientIp(
          headers({ 'x-vercel-forwarded-for': '198.51.100.9', 'x-forwarded-for': '6.6.6.6' }),
        ),
      ).toBe('198.51.100.9');
    });
  });
});
