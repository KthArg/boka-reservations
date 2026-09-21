import { TourActionError } from '@shared/constants/tours';
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

// Semántica alineada con los constraints de la migración …041 (spec 0028, B1):
//  - fila SEASONAL = al menos un límite de fecha (un límite ausente = infinito hacia ese lado);
//  - fila BASE = sin fechas; un base + temporadas conviven (la temporada gana al cobrar);
//  - dos bases del mismo tipo = conflicto; dos temporadas solapadas = conflicto,
//    con BORDES INCLUSIVOS ([from, until] cerrado, igual que el filtro de vigencia:
//    antes el borde compartido pasaba la validación pero ambas quedaban vigentes ese día).
function rangesOverlap(
  aFrom: string | null | undefined,
  aUntil: string | null | undefined,
  bFrom: string | null | undefined,
  bUntil: string | null | undefined,
): boolean {
  const aSeasonal = aFrom != null || aUntil != null;
  const bSeasonal = bFrom != null || bUntil != null;

  if (!aSeasonal && !bSeasonal) return true; // dos precios base para el mismo tipo
  if (!aSeasonal || !bSeasonal) return false; // base + temporada = ok (la temporada gana)

  const MIN_DATE = '0000-00-00';
  const MAX_DATE = '9999-12-31';
  return (aFrom ?? MIN_DATE) <= (bUntil ?? MAX_DATE) && (bFrom ?? MIN_DATE) <= (aUntil ?? MAX_DATE);
}

/**
 * Temporadas con UNA sola fecha (review pre-PR de 0028): el CHECK valid_season_range de
 * DB exige ambas o ninguna; sin este rechazo temprano el guardado moría en DB con el
 * error genérico. Se valida antes que los solapes.
 */
export function hasHalfOpenSeasons(rows: PricingRow[]): boolean {
  return rows.some((r) => r.active && (r.valid_from == null) !== (r.valid_until == null));
}

/**
 * Temporadas con rango inválido (review pre-PR): valid_season_range exige
 * `valid_from < valid_until` ESTRICTO — una temporada de un día o invertida moría en DB
 * a mitad de la reconciliación (con las eliminaciones ya aplicadas).
 */
export function hasInvalidSeasonRange(rows: PricingRow[]): boolean {
  return rows.some(
    (r) =>
      r.active && r.valid_from != null && r.valid_until != null && r.valid_from >= r.valid_until,
  );
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

export function detectPricingOverlaps(rows: PricingRow[]): OverlapError[] {
  const errors: OverlapError[] = [];
  const active = rows.map((r, i) => ({ row: r, originalIndex: i })).filter((r) => r.row.active);

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];

      if (a.row.ticket_type !== b.row.ticket_type) continue;

      if (rangesOverlap(a.row.valid_from, a.row.valid_until, b.row.valid_from, b.row.valid_until)) {
        const bothBase = a.row.valid_from == null && a.row.valid_until == null;
        errors.push({
          indices: [a.originalIndex, b.originalIndex],
          code: bothBase ? TourActionError.BasePriceDuplicate : TourActionError.PricingOverlap,
        });
      }
    }
  }

  return errors;
}
