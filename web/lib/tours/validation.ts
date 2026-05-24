import type { PricingRow } from './types';

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

type OverlapError = { indices: [number, number]; message: string };

function rangesOverlap(
  aFrom: string | null | undefined,
  aUntil: string | null | undefined,
  bFrom: string | null | undefined,
  bUntil: string | null | undefined,
): boolean {
  const aHasDates = aFrom != null && aUntil != null;
  const bHasDates = bFrom != null && bUntil != null;

  if (!aHasDates && !bHasDates) return true; // two base prices for same type
  if (!aHasDates || !bHasDates) return false; // one base + one seasonal = ok

  return aFrom < bUntil && bFrom < aUntil;
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
        errors.push({
          indices: [a.originalIndex, b.originalIndex],
          message: `Filas ${a.originalIndex + 1} y ${b.originalIndex + 1} tienen rangos solapados para el tipo "${a.row.ticket_type}"`,
        });
      }
    }
  }

  return errors;
}
