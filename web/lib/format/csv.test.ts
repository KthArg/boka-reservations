import { describe, it, expect } from 'vitest';
import { escapeCsvField, toCsv } from './csv';

describe('escapeCsvField', () => {
  it('deja intacto un valor simple', () => {
    expect(escapeCsvField('Juan Pérez')).toBe('Juan Pérez');
  });

  it('entrecomilla valores con coma, comilla o salto de línea', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('a"b')).toBe('"a""b"');
    expect(escapeCsvField('a\nb')).toBe('"a\nb"');
  });

  it('neutraliza fórmulas que empiezan con caracteres peligrosos (M-4)', () => {
    expect(escapeCsvField('=HYPERLINK("http://evil.com")')).toBe(
      `"'=HYPERLINK(""http://evil.com"")"`,
    );
    expect(escapeCsvField('+1')).toBe("'+1");
    expect(escapeCsvField('-5')).toBe("'-5");
    expect(escapeCsvField('@cmd')).toBe("'@cmd");
    expect(escapeCsvField('\tx')).toBe("'\tx");
    expect(escapeCsvField('\rx')).toBe('"\'\rx"');
  });

  it('no toca valores donde el carácter peligroso NO está al inicio', () => {
    expect(escapeCsvField('a=b')).toBe('a=b');
    expect(escapeCsvField('correo@dominio.com')).toBe('correo@dominio.com');
  });
});

describe('toCsv', () => {
  it('neutraliza fórmulas dentro de una tabla completa', () => {
    const csv = toCsv(['name'], [['=1+1'], ['ok']]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain('ok');
  });
});
