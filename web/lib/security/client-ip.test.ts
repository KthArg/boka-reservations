import { describe, expect, it } from 'vitest';
import { getClientIp } from './client-ip';
import { UNKNOWN_IP } from '@shared/constants/rate-limit';

describe('getClientIp', () => {
  it('devuelve la única IP del header', () => {
    expect(getClientIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('toma el PRIMER elemento de una cadena x-forwarded-for (la IP real en Vercel)', () => {
    expect(getClientIp('203.0.113.7, 70.41.3.18, 150.172.238.178')).toBe('203.0.113.7');
  });

  it('hace trim del valor', () => {
    expect(getClientIp('  203.0.113.7  ')).toBe('203.0.113.7');
  });

  it('ignora IPs spoofeadas que el cliente intente anteponer después de la real', () => {
    // En Vercel el primer elemento lo pone la plataforma; lo que el cliente agregue
    // queda detrás y nunca se usa como identidad.
    expect(getClientIp('1.2.3.4, 9.9.9.9')).toBe('1.2.3.4');
  });

  it('devuelve UNKNOWN_IP cuando el header está ausente', () => {
    expect(getClientIp(null)).toBe(UNKNOWN_IP);
    expect(getClientIp(undefined)).toBe(UNKNOWN_IP);
  });

  it('devuelve UNKNOWN_IP cuando el header está vacío o es solo espacios', () => {
    expect(getClientIp('')).toBe(UNKNOWN_IP);
    expect(getClientIp('   ')).toBe(UNKNOWN_IP);
  });
});
