// Unit del cálculo de cutoffs de retención (spec 0022, PRIV-03). Función pura, sin DB.
import { describe, expect, it } from 'vitest';
import { computeRetentionCutoffs } from '../../src/jobs/retention-windows.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('computeRetentionCutoffs', () => {
  const now = new Date('2026-06-13T12:00:00.000Z');

  it('PII cutoff = 18 meses antes de now', () => {
    expect(computeRetentionCutoffs(now).piiCutoff).toMatch(/^2024-12-13T/);
  });

  it('unpaid cutoff = 90 días antes de now', () => {
    const expected = new Date(now.getTime() - 90 * DAY_MS).toISOString();
    expect(computeRetentionCutoffs(now).unpaidCutoff).toBe(expected);
  });

  it('token cutoff = 7 días antes de now', () => {
    const expected = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    expect(computeRetentionCutoffs(now).tokenCutoff).toBe(expected);
  });

  it('notification cutoff = 90 días antes de now', () => {
    const expected = new Date(now.getTime() - 90 * DAY_MS).toISOString();
    expect(computeRetentionCutoffs(now).notificationCutoff).toBe(expected);
  });

  it('todos los cutoffs quedan en el pasado respecto de now', () => {
    const cutoffs = computeRetentionCutoffs(now);
    const values = [
      cutoffs.piiCutoff,
      cutoffs.unpaidCutoff,
      cutoffs.tokenCutoff,
      cutoffs.notificationCutoff,
    ];
    for (const value of values) {
      expect(new Date(value).getTime()).toBeLessThan(now.getTime());
    }
  });
});
