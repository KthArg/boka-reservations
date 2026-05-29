import { describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS,
  isTerminalAfter,
  nextScheduledFor,
} from '../../../src/notifications/backoff.js';

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;

describe('nextScheduledFor', () => {
  const now = new Date('2026-05-29T12:00:00.000Z');

  it('primer reintento (attempts=0) suma 1 minuto', () => {
    const next = nextScheduledFor(0, now);
    expect(next.getTime() - now.getTime()).toBe(MS_PER_MINUTE);
  });

  it('segundo reintento (attempts=1) suma 5 minutos', () => {
    const next = nextScheduledFor(1, now);
    expect(next.getTime() - now.getTime()).toBe(5 * MS_PER_MINUTE);
  });

  it('tercer reintento (attempts=2) suma 30 minutos', () => {
    const next = nextScheduledFor(2, now);
    expect(next.getTime() - now.getTime()).toBe(30 * MS_PER_MINUTE);
  });

  it('attempts mayor al schedule reutiliza el ultimo delay', () => {
    const next = nextScheduledFor(99, now);
    expect(next.getTime() - now.getTime()).toBe(30 * MS_PER_MINUTE);
  });
});

describe('isTerminalAfter', () => {
  it('false para 1 y 2 intentos', () => {
    expect(isTerminalAfter(1)).toBe(false);
    expect(isTerminalAfter(2)).toBe(false);
  });

  it('true cuando se alcanza MAX_ATTEMPTS', () => {
    expect(isTerminalAfter(MAX_ATTEMPTS)).toBe(true);
    expect(isTerminalAfter(MAX_ATTEMPTS + 1)).toBe(true);
  });
});
