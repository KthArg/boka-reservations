// Aviso de la política de reembolso en el checkout (spec 0032 §5.4).
import { describe, expect, it } from 'vitest';
import { refundFeeNoticeValues } from './refund-fee-notice';

const ACTIVE = '2026-10-01';

describe('refundFeeNoticeValues', () => {
  it('no muestra el aviso con la política inactiva', () => {
    expect(refundFeeNoticeValues('es', null)).toBeNull();
  });

  it('formatea la comisión en español', () => {
    const values = refundFeeNoticeValues('es', ACTIVE);
    expect(values?.percent).toBe('3,9%');
    expect(values?.fixed).toContain('0,35');
  });

  it('formatea la comisión en inglés', () => {
    expect(refundFeeNoticeValues('en', ACTIVE)).toEqual({ percent: '3.9%', fixed: '$0.35' });
  });
});
