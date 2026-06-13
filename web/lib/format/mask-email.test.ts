import { describe, expect, it } from 'vitest';
import { maskEmail } from './mask-email';

describe('maskEmail', () => {
  it('conserva la primera letra del local y el dominio', () => {
    expect(maskEmail('juan.perez@gmail.com')).toBe('j***@gmail.com');
  });

  it('enmascara un local de un solo carácter', () => {
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
  });

  it('devuelve cadena vacía si no hay @', () => {
    expect(maskEmail('nodomain')).toBe('');
  });

  it('devuelve cadena vacía con el local vacío', () => {
    expect(maskEmail('@gmail.com')).toBe('');
  });

  it('devuelve cadena vacía con el dominio vacío', () => {
    expect(maskEmail('juan@')).toBe('');
  });

  it('devuelve cadena vacía con entrada vacía', () => {
    expect(maskEmail('')).toBe('');
  });
});
