import { TourActionError } from '@shared/constants/tours';
import { isValidMonthDay, seasonsOverlap } from '@/lib/pricing/season';
import type { PricingRow, ScheduleRow } from './types';

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

type OverlapError = { indices: [number, number]; code: string };

function hasSeason(
  row: PricingRow,
): row is PricingRow & { season_start: string; season_end: string } {
  return row.season_start != null && row.season_end != null;
}

/**
 * Temporadas con una sola punta (spec 0040): el CHECK tour_pricing_season_shape exige las dos o
 * ninguna. Se valida antes que los solapes.
 */
export function hasHalfOpenSeasons(rows: PricingRow[]): boolean {
  return rows.some((r) => (r.season_start == null) !== (r.season_end == null));
}

/** Temporadas con un día que no existe (31 de abril): CHECK tour_pricing_season_days. */
export function hasInvalidSeasonRange(rows: PricingRow[]): boolean {
  return rows.some(
    (r) => hasSeason(r) && (!isValidMonthDay(r.season_start) || !isValidMonthDay(r.season_end)),
  );
}

/** Temporadas sin nombre: el CHECK tour_pricing_season_shape lo exige. */
export function hasUnlabeledSeason(rows: PricingRow[]): boolean {
  return rows.some((r) => hasSeason(r) && !r.season_label);
}

/**
 * Horarios con vigencia invertida (review pre-PR del workstream C): un rango
 * `valid_from > valid_until` hace que el generador no cree salidas SILENCIOSAMENTE
 * (lucro cesante sin alerta). tour_schedules no tiene CHECK propio en DB.
 */
export function hasInvalidScheduleRange(rows: ScheduleRow[]): boolean {
  return rows.some(
    (r) =>
      r.active && r.valid_from != null && r.valid_until != null && r.valid_from > r.valid_until,
  );
}

/**
 * Conflictos entre filas activas del mismo tiquete (spec 0040): dos precios base, o dos
 * temporadas que comparten un día del año (con bordes inclusivos y cruce de año). Un base y una
 * temporada conviven: la temporada gana en sus días.
 */
export function detectPricingOverlaps(rows: PricingRow[]): OverlapError[] {
  const errors: OverlapError[] = [];
  const active = rows.map((row, index) => ({ row, index })).filter((r) => r.row.active);

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (a.row.ticket_type !== b.row.ticket_type) continue;

      const aSeason = hasSeason(a.row);
      const bSeason = hasSeason(b.row);
      if (!aSeason && !bSeason) {
        errors.push({ indices: [a.index, b.index], code: TourActionError.BasePriceDuplicate });
      } else if (
        hasSeason(a.row) &&
        hasSeason(b.row) &&
        seasonsOverlap(
          { start: a.row.season_start, end: a.row.season_end },
          { start: b.row.season_start, end: b.row.season_end },
        )
      ) {
        errors.push({ indices: [a.index, b.index], code: TourActionError.PricingOverlap });
      }
    }
  }

  return errors;
}

/** Algún error de tarifas que el formulario puede detectar antes de enviar (spec 0040). */
export function hasPricingErrors(rows: PricingRow[]): boolean {
  return (
    hasHalfOpenSeasons(rows) ||
    hasInvalidSeasonRange(rows) ||
    hasUnlabeledSeason(rows) ||
    detectPricingOverlaps(rows).length > 0
  );
}
