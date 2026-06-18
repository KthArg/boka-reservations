import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from './safe-redirect';

const FALLBACK = '/es/dashboard';

// Construye `"/<char>/evil.com"` sin meter caracteres de control literales en el fuente
// (un LF literal en un string rompería la sintaxis; un tab/CR lo haría binario).
const withChar = (code: number) => `/${String.fromCharCode(code)}/evil.com`;

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

  it('rechaza el truco backslash en cualquier posición', () => {
    expect(safeRedirectPath(withChar(0x5c), FALLBACK)).toBe(FALLBACK); // "/\/evil.com"
    expect(safeRedirectPath('/es' + String.fromCharCode(0x5c) + 'evil.com', FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it('rechaza esquemas y valores que no empiezan con /', () => {
    expect(safeRedirectPath('javascript:alert(1)', FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath('evil.com', FALLBACK)).toBe(FALLBACK);
  });

  // F-1 (spec 0019): el navegador/parser de URL (WHATWG) ELIMINA tab/LF/CR, así que
  // "/<tab>/host" colapsaría a "//host" (protocol-relative → host externo) tras pasar el
  // chequeo de '//'. Se rechaza todo carácter de control 0x00–0x1f y 0x7f.
  it('rechaza caracteres de control que el parser de URL elimina (tab/LF/CR/NUL/DEL)', () => {
    expect(safeRedirectPath(withChar(0x09), FALLBACK)).toBe(FALLBACK); // tab
    expect(safeRedirectPath(withChar(0x0a), FALLBACK)).toBe(FALLBACK); // LF
    expect(safeRedirectPath(withChar(0x0d), FALLBACK)).toBe(FALLBACK); // CR
    expect(safeRedirectPath(withChar(0x00), FALLBACK)).toBe(FALLBACK); // NUL
    expect(safeRedirectPath(withChar(0x7f), FALLBACK)).toBe(FALLBACK); // DEL
  });

  it('sigue aceptando una ruta local legítima con un solo /', () => {
    expect(safeRedirectPath('/evil.com', FALLBACK)).toBe('/evil.com');
    expect(safeRedirectPath('/es/dashboard/reports?from=2026-01-01', FALLBACK)).toBe(
      '/es/dashboard/reports?from=2026-01-01',
    );
  });
});
