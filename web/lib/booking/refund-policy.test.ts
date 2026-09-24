// Política de reembolso (specs 0011 y 0032): ventana de 24 h, motivo de la cancelación y
// descuento de la comisión de procesamiento según la versión de términos aceptada.
import { describe, it, expect } from 'vitest';
import {
  CANCELLATION_WINDOW_MS,
  ProcessingFeeNotConfiguredError,
  REFUND_FEE_FROM_TERMS_VERSION,
  computeProcessingFee,
  computeRefund,
} from '@shared/constants/policies';
import { CancellationReason } from '@shared/constants/cancellations';
import { TERMS_VERSION } from '@shared/constants/legal';

const now = new Date('2026-06-02T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const TOTAL = 6000;
const FEE = 306;
const CUTOFF = '2026-10-01';

type Overrides = Partial<Parameters<typeof computeRefund>[0]>;

function refund(overrides: Overrides = {}) {
  return computeRefund({
    startsAt: new Date(now.getTime() + CANCELLATION_WINDOW_MS + HOUR_MS),
    totalAmountCents: TOTAL,
    currency: 'USD',
    termsVersion: CUTOFF,
    reason: CancellationReason.CustomerRequest,
    now,
    feeFromTermsVersion: CUTOFF,
    ...overrides,
  });
}

describe('computeProcessingFee', () => {
  it.each([
    [6000, 306],
    [1000, 72],
    [500, 49],
  ])('%i centavos → %i de costo (3,9 % + US$0,25 + 0,777 % de IVA)', (total, fee) => {
    expect(computeProcessingFee(total, 'USD')).toBe(fee);
  });

  it('lanza con una moneda sin comisión configurada', () => {
    expect(() => computeProcessingFee(TOTAL, 'CRC')).toThrow(ProcessingFeeNotConfiguredError);
  });
});

describe('computeRefund — a pedido del cliente', () => {
  it('descuenta la comisión con la cláusula aceptada y 24 h o más de antelación', () => {
    expect(refund()).toEqual({ eligible: true, amountCents: TOTAL - FEE, feeCents: FEE });
  });

  it('descuenta la comisión exactamente en el borde de 24 h', () => {
    const startsAt = new Date(now.getTime() + CANCELLATION_WINDOW_MS);
    expect(refund({ startsAt })).toEqual({
      eligible: true,
      amountCents: TOTAL - FEE,
      feeCents: FEE,
    });
  });

  it('no reembolsa un milisegundo dentro de la ventana', () => {
    const startsAt = new Date(now.getTime() + CANCELLATION_WINDOW_MS - 1);
    expect(refund({ startsAt })).toEqual({ eligible: false, amountCents: 0, feeCents: 0 });
  });

  it('no reembolsa si el tour ya empezó', () => {
    const startsAt = new Date(now.getTime() - HOUR_MS);
    expect(refund({ startsAt })).toEqual({ eligible: false, amountCents: 0, feeCents: 0 });
  });

  it.each([
    ['sin versión de términos (reserva anterior al 0031)', { termsVersion: null }],
    ['con términos anteriores al corte', { termsVersion: '2026-09-30' }],
    ['con la política inactiva', { feeFromTermsVersion: null }],
  ])('reembolsa el total %s', (_case, overrides) => {
    expect(refund(overrides)).toEqual({ eligible: true, amountCents: TOTAL, feeCents: 0 });
  });

  it('descuenta la comisión con términos posteriores al corte', () => {
    expect(refund({ termsVersion: '2026-11-15' }).feeCents).toBe(FEE);
  });

  it('no reembolsa nada si la comisión cubre el total', () => {
    expect(refund({ totalAmountCents: 20 })).toEqual({
      eligible: false,
      amountCents: 0,
      feeCents: 20,
    });
  });

  it('lanza con una moneda sin comisión solo cuando corresponde descontar', () => {
    expect(() => refund({ currency: 'CRC' })).toThrow(ProcessingFeeNotConfiguredError);
    expect(refund({ currency: 'CRC', termsVersion: null }).amountCents).toBe(TOTAL);
  });
});

describe('computeRefund — por decisión del operador', () => {
  it.each([
    ['con antelación y cláusula aceptada', {}],
    ['dentro de las 24 h', { startsAt: new Date(now.getTime() + HOUR_MS) }],
    ['con la salida ya empezada', { startsAt: new Date(now.getTime() - HOUR_MS) }],
    ['con una moneda sin comisión configurada', { currency: 'CRC' }],
  ])('reembolsa el total %s', (_case, overrides) => {
    expect(refund({ reason: CancellationReason.OperatorDecision, ...overrides })).toEqual({
      eligible: true,
      amountCents: TOTAL,
      feeCents: 0,
    });
  });
});

describe('versiones de términos', () => {
  const DATE_VERSION = /^\d{4}-\d{2}-\d{2}$/;

  it('TERMS_VERSION tiene formato YYYY-MM-DD, sin sufijos', () => {
    expect(TERMS_VERSION).toMatch(DATE_VERSION);
  });

  it('el corte, si está activo, tiene formato YYYY-MM-DD y lo alcanza la versión vigente', () => {
    if (REFUND_FEE_FROM_TERMS_VERSION === null) return;
    expect(REFUND_FEE_FROM_TERMS_VERSION).toMatch(DATE_VERSION);
    expect(TERMS_VERSION >= REFUND_FEE_FROM_TERMS_VERSION).toBe(true);
  });
});
