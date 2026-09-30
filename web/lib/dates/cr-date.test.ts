import { describe, expect, it } from 'vitest';
import { crClockTime, crDate, crDayStartIso, crNextDayStartIso } from './cr-date';

// Bordes del "día del negocio" (spec 0028, B4): un instante entre 18:00 y 23:59 CR
// pertenece al día CR aunque en UTC ya sea el día siguiente.
describe('crDate', () => {
  it('18:00 CR (00:00 UTC del día siguiente) sigue siendo el día CR', () => {
    expect(crDate(new Date('2026-07-07T00:00:00Z'))).toBe('2026-07-06');
  });

  it('23:59 CR (05:59 UTC del día siguiente) sigue siendo el día CR', () => {
    expect(crDate(new Date('2026-07-07T05:59:59Z'))).toBe('2026-07-06');
  });

  it('00:00 CR (06:00 UTC) ya es el día CR siguiente', () => {
    expect(crDate(new Date('2026-07-07T06:00:00Z'))).toBe('2026-07-07');
  });
});

describe('límites [inicio día CR, inicio día CR siguiente)', () => {
  it('crDayStartIso: inicio del día CR en UTC', () => {
    expect(crDayStartIso('2026-07-06')).toBe('2026-07-06T06:00:00.000Z');
  });

  it('crNextDayStartIso: inicio del día CR siguiente (límite exclusivo)', () => {
    expect(crNextDayStartIso('2026-07-06')).toBe('2026-07-07T06:00:00.000Z');
  });

  it('un tour de las 19:00 CR cae dentro del día CR filtrado', () => {
    const startsAt = '2026-07-07T01:00:00Z'; // 19:00 CR del 2026-07-06
    expect(startsAt >= crDayStartIso('2026-07-06')).toBe(true);
    expect(startsAt < crNextDayStartIso('2026-07-06')).toBe(true);
  });
});

describe('crClockTime (spec 0042)', () => {
  it('las 06:00 UTC son las 00:00 de Costa Rica, en formato de 24 h', () => {
    expect(crClockTime(new Date('2026-10-07T06:00:00Z'))).toBe('00:00');
  });

  it('las 23:30 UTC son las 17:30 de Costa Rica', () => {
    expect(crClockTime(new Date('2026-10-06T23:30:00Z'))).toBe('17:30');
  });
});
