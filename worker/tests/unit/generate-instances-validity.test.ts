// Vigencia de horarios en el generador (spec 0028, C6): valid_from/valid_until eran
// columnas muertas. Bordes en día calendario de COSTA RICA, inclusivos en ambos lados.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/env.js', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
}));

import { __testing } from '../../src/jobs/generate-tour-instances.js';

const { withinValidity, crDateOf } = __testing;

const schedule = (over: Partial<{ valid_from: string | null; valid_until: string | null }>) => ({
  id: 's1',
  tour_id: 't1',
  day_of_week: 1,
  start_time: '19:00',
  capacity: 5,
  valid_from: null,
  valid_until: null,
  ...over,
});

describe('crDateOf', () => {
  it('una salida de las 19:00 CR (01:00 UTC del día siguiente) pertenece al día CR', () => {
    expect(crDateOf('2026-08-11T01:00:00Z')).toBe('2026-08-10');
  });
});

describe('withinValidity', () => {
  // 2026-08-10T19:00 CR == 2026-08-11T01:00Z
  const EVENING_CR = '2026-08-11T01:00:00Z';

  it('sin ventana: siempre vigente', () => {
    expect(withinValidity(EVENING_CR, schedule({}))).toBe(true);
  });

  it('el día valid_until TODAVÍA genera (borde inclusivo), aún para salidas nocturnas CR', () => {
    expect(withinValidity(EVENING_CR, schedule({ valid_until: '2026-08-10' }))).toBe(true);
  });

  it('el día siguiente a valid_until ya no genera', () => {
    expect(withinValidity(EVENING_CR, schedule({ valid_until: '2026-08-09' }))).toBe(false);
  });

  it('el día valid_from ya genera (borde inclusivo); antes no', () => {
    expect(withinValidity(EVENING_CR, schedule({ valid_from: '2026-08-10' }))).toBe(true);
    expect(withinValidity(EVENING_CR, schedule({ valid_from: '2026-08-11' }))).toBe(false);
  });

  it('ventana completa: dentro sí, fuera no', () => {
    const sch = schedule({ valid_from: '2026-08-01', valid_until: '2026-08-31' });
    expect(withinValidity(EVENING_CR, sch)).toBe(true);
    expect(withinValidity('2026-09-05T01:00:00Z', sch)).toBe(false);
  });
});
