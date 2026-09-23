// Ventana de la página de confirmación (spec 0031 §5.3): muestra datos de la reserva solo durante
// las 24 h siguientes a su creación o al último inicio de cobro, lo más reciente.
import { describe, expect, it } from 'vitest';
import { isWithinSuccessWindow } from './success-window';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-09-22T12:00:00.000Z');

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe('isWithinSuccessWindow', () => {
  it('muestra con 24 h justas desde la creación', () => {
    expect(
      isWithinSuccessWindow({ createdAt: ago(24 * HOUR_MS), chargeStartedAt: null, now: NOW }),
    ).toBe(true);
  });

  it('no muestra con 24 h y 1 ms desde la creación', () => {
    expect(
      isWithinSuccessWindow({ createdAt: ago(24 * HOUR_MS + 1), chargeStartedAt: null, now: NOW }),
    ).toBe(false);
  });

  it('muestra una reserva de cobro inmediato creada hace 1 h', () => {
    expect(
      isWithinSuccessWindow({ createdAt: ago(HOUR_MS), chargeStartedAt: null, now: NOW }),
    ).toBe(true);
  });

  it('no muestra una reserva de cobro inmediato creada hace 25 h', () => {
    expect(
      isWithinSuccessWindow({ createdAt: ago(25 * HOUR_MS), chargeStartedAt: null, now: NOW }),
    ).toBe(false);
  });

  it('muestra una reserva de hace 10 días con un cobro iniciado hace 5 minutos', () => {
    expect(
      isWithinSuccessWindow({
        createdAt: ago(10 * 24 * HOUR_MS),
        chargeStartedAt: ago(5 * 60 * 1000),
        now: NOW,
      }),
    ).toBe(true);
  });

  it('toma la creación cuando es más reciente que el inicio de cobro', () => {
    expect(
      isWithinSuccessWindow({
        createdAt: ago(HOUR_MS),
        chargeStartedAt: ago(30 * 24 * HOUR_MS),
        now: NOW,
      }),
    ).toBe(true);
  });

  it('no muestra si la fecha de creación es inválida y no hay cobro', () => {
    expect(
      isWithinSuccessWindow({ createdAt: 'no-es-fecha', chargeStartedAt: null, now: NOW }),
    ).toBe(false);
  });
});
