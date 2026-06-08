import { describe, it, expect } from 'vitest';
import { operatorDayBoundsUtc, formatOperatorDateTime } from './today-range';

describe('operatorDayBoundsUtc', () => {
  it('calcula el día CR cuando en UTC ya es el día siguiente', () => {
    // 03:00Z = 21:00 del día anterior en CR (UTC-6)
    const bounds = operatorDayBoundsUtc(new Date('2026-05-30T03:00:00Z'));
    expect(bounds.startIso).toBe('2026-05-29T06:00:00.000Z');
    expect(bounds.endIso).toBe('2026-05-30T06:00:00.000Z');
  });

  it('calcula el día CR para una hora diurna', () => {
    const bounds = operatorDayBoundsUtc(new Date('2026-05-30T12:00:00Z'));
    expect(bounds.startIso).toBe('2026-05-30T06:00:00.000Z');
    expect(bounds.endIso).toBe('2026-05-31T06:00:00.000Z');
  });

  it('el rango cubre exactamente 24 horas', () => {
    const bounds = operatorDayBoundsUtc(new Date('2026-05-30T12:00:00Z'));
    const span = Date.parse(bounds.endIso) - Date.parse(bounds.startIso);
    expect(span).toBe(24 * 60 * 60 * 1000);
  });
});

describe('formatOperatorDateTime', () => {
  it('formatea fecha/hora en la zona del operador (UTC-6)', () => {
    expect(formatOperatorDateTime('2026-05-30T20:00:00Z')).toEqual({
      date: '2026-05-30',
      time: '14:00',
    });
  });

  it('corre la fecha al día anterior cuando corresponde', () => {
    expect(formatOperatorDateTime('2026-05-31T02:00:00Z')).toEqual({
      date: '2026-05-30',
      time: '20:00',
    });
  });

  it('devuelve vacío para un ISO vacío o inválido', () => {
    expect(formatOperatorDateTime('')).toEqual({ date: '', time: '' });
    expect(formatOperatorDateTime('no-es-fecha')).toEqual({ date: '', time: '' });
  });
});
