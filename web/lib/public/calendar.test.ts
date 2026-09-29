import { describe, expect, it } from 'vitest';
import {
  addMonths,
  buildMonthGrid,
  firstBookableDay,
  groupByCrDay,
  isoWeekday,
  monthsRange,
  seatsLeft,
  type CalendarDeparture,
} from './calendar';

function departure(crDay: string, seats: number, id = crDay): CalendarDeparture {
  return { id, crDay, time: '08:00', seatsLeft: seats, adultPrice: null };
}

describe('seatsLeft', () => {
  it('resta lo reservado y nunca da negativo', () => {
    expect(seatsLeft(10, 3)).toBe(7);
    expect(seatsLeft(10, 12)).toBe(0);
  });
});

describe('groupByCrDay', () => {
  it('agrupa por día y conserva el orden de las horas', () => {
    const days = groupByCrDay([
      { id: 'a', crDay: '2026-10-06', time: '08:00', seatsLeft: 5, adultPrice: null },
      { id: 'b', crDay: '2026-10-06', time: '19:00', seatsLeft: 5, adultPrice: null },
    ]);
    expect(days.get('2026-10-06')?.departures.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('un día con una salida llena y otra con lugares se puede elegir', () => {
    const days = groupByCrDay([departure('2026-10-06', 0, 'a'), departure('2026-10-06', 4, 'b')]);
    expect(days.get('2026-10-06')?.bookable).toBe(true);
  });

  it('un día con todas sus salidas llenas no se puede elegir', () => {
    const days = groupByCrDay([departure('2026-10-06', 0)]);
    expect(days.get('2026-10-06')?.bookable).toBe(false);
  });
});

describe('monthsRange y firstBookableDay', () => {
  it('ignoran los días llenos', () => {
    const days = groupByCrDay([
      departure('2026-09-30', 0),
      departure('2026-10-06', 3),
      departure('2026-11-02', 0),
    ]);
    expect(monthsRange(days)).toEqual({ first: '2026-10', last: '2026-10' });
    expect(firstBookableDay(days)).toBe('2026-10-06');
  });

  it('un día de Costa Rica al final del mes queda en ese mes', () => {
    const days = groupByCrDay([departure('2026-10-31', 2)]);
    expect(monthsRange(days)).toEqual({ first: '2026-10', last: '2026-10' });
  });

  it('con todas llenas no hay rango ni día', () => {
    const days = groupByCrDay([departure('2026-10-06', 0)]);
    expect(monthsRange(days)).toBeNull();
    expect(firstBookableDay(days)).toBeNull();
  });

  it('por mes devuelve el primero con lugares o nada', () => {
    const days = groupByCrDay([departure('2026-10-06', 0), departure('2026-10-13', 2)]);
    expect(firstBookableDay(days, '2026-10')).toBe('2026-10-13');
    expect(firstBookableDay(days, '2026-11')).toBeNull();
  });
});

describe('buildMonthGrid', () => {
  it('septiembre de 2026 empieza en martes: una celda vacía al principio', () => {
    const weeks = buildMonthGrid('2026-09');
    expect(weeks[0]).toEqual([
      null,
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('mayo de 2026 termina en domingo: sin celdas al final', () => {
    const weeks = buildMonthGrid('2026-05');
    expect(weeks[weeks.length - 1][6]).toBe('2026-05-31');
  });
});

describe('addMonths e isoWeekday', () => {
  it('cruza el año', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });

  it('numera de lunes (1) a domingo (7)', () => {
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(isoWeekday('2026-10-11')).toBe(7);
  });
});
