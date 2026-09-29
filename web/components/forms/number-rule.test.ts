import { describe, expect, it } from 'vitest';
import { clampToRule, isValidNumber, parseDraft } from './number-rule';

describe('parseDraft', () => {
  it('un campo vacío no es un cero', () => {
    expect(parseDraft('')).toBeNaN();
    expect(parseDraft('  ')).toBeNaN();
  });

  it('lee números con decimales', () => {
    expect(parseDraft('12.50')).toBe(12.5);
  });
});

describe('isValidNumber', () => {
  it('rechaza NaN, lo que está fuera de rango y los decimales si pide entero', () => {
    expect(isValidNumber(Number.NaN, { min: 0 })).toBe(false);
    expect(isValidNumber(-1, { min: 0 })).toBe(false);
    expect(isValidNumber(11, { min: 0, max: 10 })).toBe(false);
    expect(isValidNumber(2.5, { min: 1, integer: true })).toBe(false);
  });

  it('acepta un precio de 0 y una capacidad entera', () => {
    expect(isValidNumber(0, { min: 0 })).toBe(true);
    expect(isValidNumber(8, { min: 1, integer: true })).toBe(true);
  });
});

describe('clampToRule', () => {
  it('vacío vuelve al mínimo y lo que se pasa queda en el máximo', () => {
    expect(clampToRule(Number.NaN, { min: 0, max: 10 })).toBe(0);
    expect(clampToRule(15, { min: 0, max: 10, integer: true })).toBe(10);
    expect(clampToRule(2.4, { min: 0, max: 10, integer: true })).toBe(2);
  });
});
