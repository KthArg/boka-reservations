// Vigencia invertida de un horario (spec 0044): se compara contra el "Desde" efectivo, que vacío es
// hoy en Costa Rica (lo que guarda mapSchedules), y en todas las filas.
import { describe, expect, it } from 'vitest';
import { hasInvalidScheduleRange } from './validation';
import type { ScheduleRow } from './types';

const TODAY = '2026-10-03';

function row(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return { day_of_week: 1, start_time: '08:00', capacity: 10, active: true, ...overrides };
}

describe('hasInvalidScheduleRange', () => {
  it('accepts an open-ended schedule and a valid window', () => {
    expect(hasInvalidScheduleRange([row()], TODAY)).toBe(false);
    expect(
      hasInvalidScheduleRange(
        [row({ valid_from: '2026-10-05', valid_until: '2026-10-05' })],
        TODAY,
      ),
    ).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    expect(
      hasInvalidScheduleRange(
        [row({ valid_from: '2026-10-10', valid_until: '2026-10-05' })],
        TODAY,
      ),
    ).toBe(true);
  });

  // Sin "Desde", el horario rige desde hoy: un "Hasta" de ayer dejaría una vigencia invertida.
  it('rejects an end date in the past when the start date is empty', () => {
    expect(hasInvalidScheduleRange([row({ valid_until: '2026-10-02' })], TODAY)).toBe(true);
    expect(hasInvalidScheduleRange([row({ valid_until: TODAY })], TODAY)).toBe(false);
  });

  it('checks inactive rows too', () => {
    expect(
      hasInvalidScheduleRange(
        [row({ active: false, valid_from: '2026-10-10', valid_until: '2026-10-05' })],
        TODAY,
      ),
    ).toBe(true);
  });
});
