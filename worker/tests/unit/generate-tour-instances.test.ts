import { describe, it, expect } from 'vitest';
import { buildInstanceDates } from '../../src/jobs/tour-instance-dates.js';

const schedule = {
  id: 'sch-001',
  tour_id: 'tour-001',
  day_of_week: 5, // viernes
  start_time: '07:00',
  capacity: 8,
  duration_minutes: 120,
};

describe('buildInstanceDates', () => {
  it('genera solo fechas que coinciden con day_of_week', () => {
    // 2026-05-19 es martes (UTC) — el próximo viernes CR es 2026-05-22
    const from = new Date('2026-05-19T00:00:00Z');
    const results = buildInstanceDates(schedule, from, 7);

    expect(results.length).toBe(1);
    // starts_at: viernes 22 mayo 2026, 07:00 CR = 13:00 UTC
    const startsAt = new Date(results[0]!.starts_at);
    expect(startsAt.toISOString()).toBe('2026-05-22T13:00:00.000Z');
  });

  it('genera múltiples semanas dentro del rango', () => {
    const from = new Date('2026-05-19T00:00:00Z');
    const results = buildInstanceDates(schedule, from, 21);
    expect(results.length).toBe(3);
  });

  it('calcula ends_at sumando duration_minutes', () => {
    // 2026-05-23T00:00:00Z = CR viernes 22 mayo a las 18:00 → hit
    const from = new Date('2026-05-23T00:00:00Z');
    const results = buildInstanceDates(schedule, from, 1);
    expect(results.length).toBe(1);

    const starts = new Date(results[0]!.starts_at);
    const ends = new Date(results[0]!.ends_at);
    const diffMinutes = (ends.getTime() - starts.getTime()) / 60_000;
    expect(diffMinutes).toBe(120);
  });

  it('devuelve lista vacía si no hay coincidencias en el rango', () => {
    // días 0-3: CR lunes-jueves (sin viernes)
    const from = new Date('2026-05-19T00:00:00Z');
    const results = buildInstanceDates(schedule, from, 4);
    expect(results.length).toBe(0);
  });

  it('es idempotente — mismos inputs, mismos outputs', () => {
    const from = new Date('2026-05-19T00:00:00Z');
    const r1 = buildInstanceDates(schedule, from, 14);
    const r2 = buildInstanceDates(schedule, from, 14);
    expect(r1).toEqual(r2);
  });
});
