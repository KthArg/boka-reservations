// Decisiones puras del ciclo de cobro de una salida (spec 0033 §5.3 a §5.6). La regla que estos
// casos protegen es "todo o nada": la plata solo se mueve cuando los cupos autorizados alcanzan el
// mínimo, y soltar es siempre preferible a capturar de menos.
import { describe, expect, it } from 'vitest';
import {
  CycleAction,
  ReleaseOutcome,
  STALE_MARK_MS,
  decideCycle,
  decideRelease,
  canAttempt,
  isStaleMark,
  isTooLateToCancelForMinimum,
  type CycleInput,
} from '../../../src/charges/departure-cycle.js';
import type { ChargeableBooking } from '../../../src/charges/departure-repository.js';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-10-01T12:00:00Z');
const inHours = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS);

/** Mínimo de 4, dos autorizadas, plazo en 6 h, salida en 10 días y dos reservas por intentar. */
function cycle(overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    captured: 0,
    authorized: 2,
    minimum: 4,
    deadline: inHours(6),
    startsAt: inHours(240),
    now: NOW,
    ...overrides,
  };
}

function booking(overrides: Partial<ChargeableBooking> = {}): ChargeableBooking {
  return {
    id: 'b1',
    status: 'pending_minimum',
    total_amount_cents: 6000,
    currency: 'USD',
    locale: 'es',
    payment_method_id: 'pm_1',
    authorized_at: null,
    cancel_claimed_at: null,
    capture_started_at: null,
    charge_next_attempt_at: null,
    charge_attempts: 0,
    ...overrides,
  };
}

describe('decideCycle — todo o nada', () => {
  it('captures once the authorized seats reach the minimum', () => {
    expect(decideCycle(cycle({ authorized: 4 }))).toBe(CycleAction.Capture);
  });

  it('captures when the authorized seats exceed the minimum', () => {
    expect(decideCycle(cycle({ authorized: 7 }))).toBe(CycleAction.Capture);
  });

  // La captura manda incluso con el plazo vencido: el mínimo está, la salida sale.
  it('captures an already reached minimum even after the deadline passed', () => {
    expect(decideCycle(cycle({ authorized: 4, deadline: inHours(-1) }))).toBe(CycleAction.Capture);
  });

  it('waits while the deadline has not passed and attempts remain', () => {
    expect(decideCycle(cycle())).toBe(CycleAction.Wait);
  });

  // Hasta que el plazo venza pueden entrar reservas nuevas: esperar es lo que da esa chance, y
  // mientras tanto no se mueve un centavo.
  it('waits below the minimum even when no booking has a retry left', () => {
    expect(decideCycle(cycle({ authorized: 3 }))).toBe(CycleAction.Wait);
  });

  it('releases once the deadline passed below the minimum', () => {
    expect(decideCycle(cycle({ deadline: inHours(-1) }))).toBe(CycleAction.Release);
  });

  it('releases at the exact instant the deadline expires', () => {
    expect(decideCycle(cycle({ deadline: NOW }))).toBe(CycleAction.Release);
  });

  it('releases a departure that nobody authorized', () => {
    expect(decideCycle(cycle({ authorized: 0, deadline: inHours(-1) }))).toBe(CycleAction.Release);
  });
});

describe('decideRelease — qué pasa con la salida después de soltar', () => {
  // Cancelar una salida a la que le faltan semanas por una foto de hoy sería cancelar de más: se
  // cierra el ciclo y se vuelve a intentar más cerca de la fecha.
  it('closes the cycle while the departure is still far away', () => {
    expect(decideRelease(cycle({ startsAt: inHours(100) }))).toBe(ReleaseOutcome.Close);
  });

  // Decisión del usuario (2026-10-02): si la salida se hace o se cancela lo decide una persona.
  it('always leaves the decision to a person near the departure', () => {
    expect(decideRelease(cycle({ startsAt: inHours(30) }))).toBe(ReleaseOutcome.StaffDecision);
    expect(decideRelease(cycle({ startsAt: inHours(20) }))).toBe(ReleaseOutcome.StaffDecision);
    expect(decideRelease(cycle({ startsAt: inHours(30), captured: 2 }))).toBe(
      ReleaseOutcome.StaffDecision,
    );
  });

  it('closes rather than deciding beyond the 72 h floor', () => {
    expect(decideRelease(cycle({ startsAt: inHours(72) }))).toBe(ReleaseOutcome.StaffDecision);
    expect(decideRelease(cycle({ startsAt: inHours(73) }))).toBe(ReleaseOutcome.Close);
  });
});

describe('isTooLateToCancelForMinimum — el aviso de 24 horas', () => {
  it('is not too late while 24 h or more remain', () => {
    expect(isTooLateToCancelForMinimum(cycle({ startsAt: inHours(24) }))).toBe(false);
  });

  it('is too late with less than 24 h, and on a departure that already started', () => {
    expect(isTooLateToCancelForMinimum(cycle({ startsAt: inHours(23.9) }))).toBe(true);
    expect(isTooLateToCancelForMinimum(cycle({ startsAt: inHours(-1) }))).toBe(true);
  });
});

describe('isStaleMark — marcas de un proceso que murió', () => {
  it('treats no mark as not stale', () => {
    expect(isStaleMark(null, NOW)).toBe(false);
  });

  it('keeps a fresh mark: el otro proceso sigue hablando con OnvoPay', () => {
    expect(isStaleMark(new Date(NOW.getTime() - STALE_MARK_MS + 1000), NOW)).toBe(false);
  });

  it('clears a mark older than the window', () => {
    expect(isStaleMark(new Date(NOW.getTime() - STALE_MARK_MS - 1000), NOW)).toBe(true);
  });
});

describe('canAttempt — reintentos disponibles', () => {
  it('attempts a booking that never tried', () => {
    expect(canAttempt(booking(), NOW)).toBe(true);
  });

  /**
   * `charge_next_attempt_at` en null significa dos cosas: nunca falló, o agotó sus reintentos. Sin
   * el chequeo de `charge_attempts` una tarjeta definitivamente rechazada se reconfirmaría cada
   * minuto y el turista recibiría un aviso de rechazo cada vez.
   */
  it('never attempts a booking whose retries ran out', () => {
    expect(canAttempt(booking({ charge_attempts: 4 }), NOW)).toBe(false);
  });

  it('waits while the backoff has not elapsed', () => {
    expect(
      canAttempt(
        booking({ charge_attempts: 1, charge_next_attempt_at: inHours(1).toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });

  it('attempts once the backoff elapsed', () => {
    expect(
      canAttempt(
        booking({ charge_attempts: 1, charge_next_attempt_at: inHours(-1).toISOString() }),
        NOW,
      ),
    ).toBe(true);
  });

  it('attempts at the exact instant the backoff expires', () => {
    expect(
      canAttempt(booking({ charge_attempts: 1, charge_next_attempt_at: NOW.toISOString() }), NOW),
    ).toBe(true);
  });
});
