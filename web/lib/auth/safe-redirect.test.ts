import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from './safe-redirect';

const FALLBACK = '/es/dashboard';

describe('safeRedirectPath', () => {
  it('acepta una ruta local con un único /', () => {
    expect(safeRedirectPath('/es/dashboard/bookings', FALLBACK)).toBe('/es/dashboard/bookings');
  });

  it('usa el fallback si es undefined o vacío', () => {
    expect(safeRedirectPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath('', FALLBACK)).toBe(FALLBACK);
  });

  it('rechaza URLs absolutas externas', () => {
    expect(safeRedirectPath('https://evil.com', FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath('http://evil.com/path', FALLBACK)).toBe(FALLBACK);
  });

  it('rechaza rutas protocol-relative (//host)', () => {
    expect(safeRedirectPath('//evil.com', FALLBACK)).toBe(FALLBACK);
  });

  it('rechaza el truco backslash (/\\host)', () => {
    expect(safeRedirectPath('/\\evil.com', FALLBACK)).toBe(FALLBACK);
  });

  it('rechaza esquemas y valores que no empiezan con /', () => {
    expect(safeRedirectPath('javascript:alert(1)', FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath('evil.com', FALLBACK)).toBe(FALLBACK);
  });
});
