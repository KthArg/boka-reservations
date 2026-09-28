import { describe, expect, it } from 'vitest';
import { minimumView, type MinimumInput } from './minimum';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

function input(overrides: Partial<MinimumInput> = {}): MinimumInput {
  return {
    startsAt: new Date(NOW.getTime() + 48 * HOUR_MS).toISOString(),
    minParticipants: 4,
    seats: 2,
    resolvedAt: null,
    deferredFlow: false,
    now: NOW,
    ...overrides,
  };
}

describe('minimumView', () => {
  it('lleva a la bandeja una salida bajo el mínimo con el corte dentro de 72 horas', () => {
    expect(minimumView(input()).needsDecision).toBe(true);
  });

  it('no la lleva si el corte cae más allá de 72 horas', () => {
    const startsAt = new Date(NOW.getTime() + 98 * HOUR_MS).toISOString();
    expect(minimumView(input({ startsAt })).needsDecision).toBe(false);
  });

  it.each([
    ['alcanzó el mínimo', { seats: 4 }],
    ['el mínimo es 1', { minParticipants: 1, seats: 0 }],
    ['ya está resuelta', { resolvedAt: NOW.toISOString() }],
    ['es del cobro diferido', { deferredFlow: true }],
  ])('no la lleva si %s', (_case, overrides) => {
    expect(minimumView(input(overrides)).needsDecision).toBe(false);
  });

  it('con 24 horas o menos ya no se cancela por mínimo', () => {
    const startsAt = new Date(NOW.getTime() + 24 * HOUR_MS).toISOString();
    expect(minimumView(input({ startsAt })).canCancelForMinimum).toBe(false);
    expect(minimumView(input()).canCancelForMinimum).toBe(true);
  });

  it('el corte es el inicio menos 25 horas', () => {
    expect(minimumView(input()).cutoffAt).toBe(
      new Date(NOW.getTime() + 23 * HOUR_MS).toISOString(),
    );
  });
});
