import { describe, expect, it } from 'vitest';
import { ReportRangeError } from '@shared/constants/reports';
import { validateReportRange, defaultReportRange, toRangeBounds } from './range';

describe('validateReportRange', () => {
  it('falta una fecha → Missing', () => {
    expect(validateReportRange(undefined, '2024-02-01')).toBe(ReportRangeError.Missing);
    expect(validateReportRange('2024-02-01', undefined)).toBe(ReportRangeError.Missing);
  });

  it('desde posterior a hasta → Inverted', () => {
    expect(validateReportRange('2024-02-10', '2024-02-01')).toBe(ReportRangeError.Inverted);
  });

  it('rango mayor a un año → TooLong', () => {
    expect(validateReportRange('2024-01-01', '2025-06-01')).toBe(ReportRangeError.TooLong);
  });

  it('rango válido → null', () => {
    expect(validateReportRange('2024-02-01', '2024-02-28')).toBeNull();
    expect(validateReportRange('2024-02-15', '2024-02-15')).toBeNull();
  });
});

describe('defaultReportRange', () => {
  it('del primer día del mes en curso a hoy (hora CR)', () => {
    const range = defaultReportRange(new Date('2024-02-15T12:00:00Z'));
    expect(range).toEqual({ from: '2024-02-01', to: '2024-02-15' });
  });
});

describe('toRangeBounds', () => {
  it('mapea a [inicio del "desde", inicio del día siguiente al "hasta") en hora CR', () => {
    const bounds = toRangeBounds({ from: '2024-02-01', to: '2024-02-28' });
    // CR = UTC-6 → medianoche CR del 1ro = 06:00Z; "hasta" inclusivo → 29 a las 06:00Z.
    expect(bounds.fromIso).toBe('2024-02-01T06:00:00.000Z');
    expect(bounds.toIso).toBe('2024-02-29T06:00:00.000Z');
  });
});
