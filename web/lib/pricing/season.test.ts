import { describe, expect, it } from 'vitest';
import {
  coversWholeYear,
  inSeason,
  isValidMonthDay,
  lowestChargedPrice,
  monthDay,
  seasonsOverlap,
  selectPriceForDay,
  type PriceRow,
} from './season';

function row(
  ticket: string,
  price: number,
  start: string | null = null,
  end: string | null = null,
): PriceRow {
  return { ticket_type: ticket, price_usd: price, season_start: start, season_end: end };
}

describe('isValidMonthDay', () => {
  it('acepta días reales, incluido el 29 de febrero', () => {
    expect(isValidMonthDay('02-29')).toBe(true);
    expect(isValidMonthDay('12-31')).toBe(true);
  });

  it('rechaza días que no existen y formatos inválidos', () => {
    expect(isValidMonthDay('04-31')).toBe(false);
    expect(isValidMonthDay('02-30')).toBe(false);
    expect(isValidMonthDay('13-01')).toBe(false);
    expect(isValidMonthDay('1-5')).toBe(false);
  });

  it('monthDay arma MM-DD', () => {
    expect(monthDay(3, 7)).toBe('03-07');
  });
});

describe('inSeason', () => {
  it('rango dentro del año, con bordes', () => {
    expect(inSeason('09-01', '09-01', '10-31')).toBe(true);
    expect(inSeason('10-31', '09-01', '10-31')).toBe(true);
    expect(inSeason('11-01', '09-01', '10-31')).toBe(false);
  });

  it('rango que cruza el año', () => {
    expect(inSeason('12-20', '12-15', '04-30')).toBe(true);
    expect(inSeason('01-03', '12-15', '04-30')).toBe(true);
    expect(inSeason('04-30', '12-15', '04-30')).toBe(true);
    expect(inSeason('05-01', '12-15', '04-30')).toBe(false);
  });

  it('un solo día y el 29 de febrero', () => {
    expect(inSeason('01-01', '01-01', '01-01')).toBe(true);
    expect(inSeason('01-02', '01-01', '01-01')).toBe(false);
    expect(inSeason('03-01', '02-01', '02-29')).toBe(false);
  });
});

describe('seasonsOverlap', () => {
  it('contiguas no chocan; compartir un día sí', () => {
    expect(seasonsOverlap({ start: '12-15', end: '04-30' }, { start: '05-01', end: '12-14' })).toBe(
      false,
    );
    expect(seasonsOverlap({ start: '12-15', end: '04-30' }, { start: '04-30', end: '06-01' })).toBe(
      true,
    );
  });

  it('dos que cruzan el año siempre chocan', () => {
    expect(seasonsOverlap({ start: '11-01', end: '01-15' }, { start: '12-20', end: '02-01' })).toBe(
      true,
    );
  });

  it('el 29/02 choca con un rango que lo incluye y no con uno que termina el 28/02', () => {
    expect(seasonsOverlap({ start: '02-29', end: '02-29' }, { start: '02-28', end: '03-01' })).toBe(
      true,
    );
    expect(seasonsOverlap({ start: '02-29', end: '02-29' }, { start: '01-01', end: '02-28' })).toBe(
      false,
    );
  });
});

describe('selectPriceForDay', () => {
  const rows = [row('adult', 50), row('adult', 65, '12-15', '04-30'), row('child', 40)];

  it('dentro de la temporada gana la temporada; fuera, el base', () => {
    expect(
      selectPriceForDay(rows, '2026-12-20').find((r) => r.ticket_type === 'adult')?.price_usd,
    ).toBe(65);
    expect(
      selectPriceForDay(rows, '2027-01-03').find((r) => r.ticket_type === 'adult')?.price_usd,
    ).toBe(65);
    expect(
      selectPriceForDay(rows, '2027-05-01').find((r) => r.ticket_type === 'adult')?.price_usd,
    ).toBe(50);
  });

  it('cada tiquete por separado; sin precio, no aparece', () => {
    const day = selectPriceForDay([row('adult', 65, '12-15', '04-30')], '2027-06-01');
    expect(day).toEqual([]);
    expect(
      selectPriceForDay(rows, '2026-12-20')
        .map((r) => r.ticket_type)
        .sort(),
    ).toEqual(['adult', 'child']);
  });

  it('todo el año: el base no se usa', () => {
    const allYear = [row('adult', 50), row('adult', 70, '01-01', '12-31')];
    expect(selectPriceForDay(allYear, '2026-07-10')[0].price_usd).toBe(70);
  });
});

describe('coversWholeYear y lowestChargedPrice', () => {
  it('dos temporadas contiguas que cruzan el año cubren todo', () => {
    expect(
      coversWholeYear([
        { start: '12-15', end: '04-30' },
        { start: '05-01', end: '12-14' },
      ]),
    ).toBe(true);
    expect(coversWholeYear([{ start: '01-01', end: '12-30' }])).toBe(false);
  });

  it('"desde" no anuncia un base que nunca se cobra', () => {
    const covered = [
      row('adult', 20),
      row('adult', 65, '12-15', '04-30'),
      row('adult', 45, '05-01', '12-14'),
    ];
    expect(lowestChargedPrice(covered, 'adult')).toBe(45);
    const partial = [row('adult', 20), row('adult', 65, '12-15', '04-30')];
    expect(lowestChargedPrice(partial, 'adult')).toBe(20);
    expect(lowestChargedPrice(partial, 'child')).toBeNull();
  });
});
