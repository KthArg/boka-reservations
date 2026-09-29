import { isValidNumber, type NumberRule } from '@/components/forms/number-rule';
import type { PricingRow, ScheduleRow } from './types';

/** Precio de una tarifa: 0 o más (el mismo mínimo que `PricingRowSchema`). */
export const PRICE_RULE: NumberRule = { min: 0 };

/** Capacidad de un horario: entero de 1 o más (el mismo mínimo que `ScheduleRowSchema`). */
export const CAPACITY_RULE: NumberRule = { min: 1, integer: true };

/** Algún precio o capacidad está vacío o fuera de regla: el formulario no se envía. */
export function hasInvalidNumbers(pricing: PricingRow[], schedules: ScheduleRow[]): boolean {
  return (
    pricing.some((row) => !isValidNumber(row.price_usd, PRICE_RULE)) ||
    schedules.some((row) => !isValidNumber(row.capacity, CAPACITY_RULE))
  );
}
