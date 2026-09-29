import { describe, expect, it } from 'vitest';
import { TicketType } from '@shared/constants/enums';
import { TourActionError } from '@shared/constants/tours';
import {
  detectPricingOverlaps,
  hasHalfOpenSeasons,
  hasInvalidSeasonRange,
  hasUnlabeledSeason,
} from '@/lib/tours/validation';
import type { PricingRow } from '@/lib/tours/types';

// Temporadas día-mes que se repiten cada año (spec 0040; antes spec 0028 con fechas con año).

const row = (overrides: Partial<PricingRow> = {}): PricingRow => ({
  ticket_type: TicketType.Adult,
  price_usd: 50,
  active: true,
  ...overrides,
});
const season = (start: string, end: string, label = 'alta') =>
  row({ season_start: start, season_end: end, season_label: label });

describe('detectPricingOverlaps — temporadas que se repiten (spec 0040)', () => {
  it('base + temporada conviven (la temporada gana en sus días)', () => {
    expect(detectPricingOverlaps([row(), season('12-15', '04-30')])).toHaveLength(0);
  });

  it('contiguas no chocan; compartir el día borde sí', () => {
    expect(
      detectPricingOverlaps([season('12-15', '04-30'), season('05-01', '12-14', 'baja')]),
    ).toHaveLength(0);
    expect(
      detectPricingOverlaps([season('12-15', '04-30'), season('04-30', '06-01', 'baja')]),
    ).toEqual([{ indices: [0, 1], code: TourActionError.PricingOverlap }]);
  });

  it('una temporada que cruza el año choca con otra en enero', () => {
    expect(
      detectPricingOverlaps([season('12-15', '04-30'), season('01-10', '01-20', 'pico')]),
    ).toHaveLength(1);
  });

  it('dos precios base del mismo tiquete', () => {
    expect(detectPricingOverlaps([row(), row()])).toEqual([
      { indices: [0, 1], code: TourActionError.BasePriceDuplicate },
    ]);
  });

  it('inactivas y otro tiquete no cuentan', () => {
    expect(
      detectPricingOverlaps([
        season('12-15', '04-30'),
        { ...season('01-01', '02-01', 'pico'), active: false },
        { ...season('01-01', '02-01', 'pico'), ticket_type: TicketType.Child },
      ]),
    ).toHaveLength(0);
  });
});

describe('validaciones de forma (spec 0040)', () => {
  it('hasHalfOpenSeasons: una sola punta', () => {
    expect(hasHalfOpenSeasons([row({ season_start: '12-15', season_end: null })])).toBe(true);
    expect(hasHalfOpenSeasons([season('12-15', '04-30'), row()])).toBe(false);
  });

  it('hasInvalidSeasonRange: un día que no existe', () => {
    expect(hasInvalidSeasonRange([season('04-31', '05-10')])).toBe(true);
    expect(hasInvalidSeasonRange([season('02-29', '03-10')])).toBe(false);
  });

  it('hasUnlabeledSeason: temporada sin nombre', () => {
    expect(hasUnlabeledSeason([row({ season_start: '12-15', season_end: '04-30' })])).toBe(true);
    expect(hasUnlabeledSeason([season('12-15', '04-30'), row()])).toBe(false);
  });
});
